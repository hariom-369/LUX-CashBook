import { Types, type Model } from 'mongoose';
import {
  TRANSACTION_META,
  TRASH_ITEM_TYPES,
  trashCutoff,
  trashDaysRemaining,
  trashExpiresAt,
  type TrashItemDto,
  type TrashItemType,
  type TrashRestoreResultDto,
} from '@khata/shared';
import {
  Account,
  Attachment,
  Budget,
  DayClosing,
  ExpenseGroup,
  GroupExpense,
  GroupSettlement,
  ImportProfile,
  InstallmentPlan,
  Invoice,
  Payee,
  Person,
  PettyCash,
  Project,
  Quotation,
  RecurringTransaction,
  Reminder,
  SavingsGoal,
  SystemMarker,
  Transaction,
} from '../../models/index.js';
import { AppError, conflict, forbidden, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type { RequestScope } from '../../middleware/context.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';
import { excludeHiddenTransactions, getHiddenTransactionIds } from '../../services/accountVisibility.js';
import { restoreTransaction } from '../transactions/transaction.service.js';
import { eraseAttachment, restoreAttachment } from '../attachments/attachment.service.js';
import { computeNextRun } from '../recurring/recurring.service.js';

/**
 * Trash / Recently Deleted (§Trash).
 *
 * Each supported record type keeps its own delete endpoint; deleting sets `deletedAt`, which
 * already takes it out of every list, balance and report (a transaction's money is reversed at
 * that moment, exactly as before). This module lists what is in Trash, restores it, and
 * permanently deletes it — on request, or automatically once 30 days have passed since the
 * original deletion (`purgeExpiredTrash`, run by the scheduler).
 *
 * Safety rules, all enforced here on the server:
 *  - Everything is scoped to the caller's workspace, and records tied to another member's
 *    private account are neither listed nor touchable — the same rule the rest of the app uses.
 *  - Restoring and purging are both conditional writes on `deletedAt`, and restore refuses
 *    anything past its 30 days, so a restore and a purge can never both win, and repeating a
 *    request can never apply a record's effect twice.
 *  - A record that other live records still point to is never erased: a person with
 *    transaction history, or an account a recurring entry still posts to, is kept (hidden,
 *    marked `trashRetainedAt`) instead — financial history is never broken to free space.
 *  - Permanent deletion on request needs the workspace owner or an admin, and an explicit
 *    confirmation in the request body.
 *  - Purging never removes the transactions in your books that a group recorded, and a
 *    transaction's own receipts go with it (their files are removed, then their records).
 */

/**
 * The models Trash works across. Their document types differ and Trash only touches the fields
 * they all share (`_id`, `workspaceId`, `deletedAt`, a name), so they are held under one loose
 * type — a union of them is not callable in TypeScript.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = Model<any>;

const LIST_CAP_PER_TYPE = 1000;
const PURGE_BATCH = 100;
const PURGE_CAP_PER_TYPE = 1000;

type Outcome = 'purged' | 'kept' | 'waiting' | 'missing';

interface Listed {
  id: string;
  name: string;
  deletedAt: Date;
  detail?: string;
  date?: Date;
  amountMinor?: number;
  currency?: string;
  transactionType?: string;
}

/** `deletedAt` within the last 30 days — what Trash shows and what can still be restored. */
const inTrash = (now: Date) => ({ $ne: null, $gt: trashCutoff(now) });

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─────────────────────────────────────────────── Listing

async function listTransactions(scope: RequestScope, search: RegExp | null, now: Date): Promise<Listed[]> {
  const rows = await Transaction.find({
    workspaceId: scope.workspaceId,
    deletedAt: inTrash(now),
    trashRetainedAt: null,
    ...excludeHiddenTransactions(scope),
    ...(search ? { description: search } : {}),
  })
    .sort({ deletedAt: -1 })
    .limit(LIST_CAP_PER_TYPE)
    .lean();

  // A group's own entries come back with the group, not one by one: leave out any whose group
  // expense or payment has since been changed or removed (restore would refuse them anyway).
  const groupExpenseIds = rows.map((r) => r.groupExpenseId).filter((id): id is Types.ObjectId => Boolean(id));
  const [expenses, settlements] = await Promise.all([
    groupExpenseIds.length ? GroupExpense.find({ _id: { $in: groupExpenseIds }, deletedAt: null }).lean() : [],
    GroupSettlement.find({ workspaceId: scope.workspaceId, transactionId: { $in: rows.map((r) => r._id) }, deletedAt: { $ne: null } })
      .select('transactionId')
      .lean(),
  ]);
  const linked = new Set(
    expenses.flatMap((e) => [e.myExpenseTransactionId, e.myBorrowTransactionId, ...e.memberShares.map((s) => s.transactionId)]).filter(Boolean).map(String),
  );
  const orphanedSettlement = new Set(settlements.map((s) => String(s.transactionId)));

  return rows
    .filter((r) => (!r.groupExpenseId || linked.has(String(r._id))) && !orphanedSettlement.has(String(r._id)))
    .map((r) => ({
      id: String(r._id),
      name: r.description || TRANSACTION_META[r.type].label,
      deletedAt: r.deletedAt!,
      date: r.date,
      amountMinor: r.amountMinor,
      currency: r.currency,
      transactionType: r.type,
    }));
}

async function listDocuments(scope: RequestScope, search: RegExp | null, now: Date): Promise<Listed[]> {
  const hiddenTransactions = await getHiddenTransactionIds(scope);
  const rows = await Attachment.find({
    workspaceId: scope.workspaceId,
    deletedAt: inTrash(now),
    ...(hiddenTransactions.length ? { transactionId: { $nin: hiddenTransactions } } : {}),
    ...(scope.hiddenAccountIds.length ? { accountId: { $nin: scope.hiddenAccountIds } } : {}),
    ...(search ? { $or: [{ title: search }, { fileName: search }] } : {}),
  })
    .sort({ deletedAt: -1 })
    .limit(LIST_CAP_PER_TYPE)
    .lean();
  return rows.map((r) => ({
    id: String(r._id),
    name: r.title || r.fileName,
    detail: r.title && r.title !== r.fileName ? r.fileName : undefined,
    deletedAt: r.deletedAt!,
  }));
}

/** The simple types: one name field, an optional private-account field to hide by. */
const SIMPLE: Record<
  Exclude<TrashItemType, 'transaction' | 'document'>,
  { model: AnyModel; nameField: string; hiddenBy?: string[]; retainable?: boolean; extraFilter?: Record<string, unknown> }
> = {
  account: { model: Account, nameField: 'name', hiddenBy: ['_id'], retainable: true },
  person: { model: Person, nameField: 'name', retainable: true },
  group: { model: ExpenseGroup, nameField: 'name' },
  budget: { model: Budget, nameField: 'name', hiddenBy: ['accountId'] },
  goal: { model: SavingsGoal, nameField: 'name', hiddenBy: ['linkedAccountId'] },
  recurring: { model: RecurringTransaction, nameField: 'name', hiddenBy: ['accountId', 'toAccountId'] },
  reminder: { model: Reminder, nameField: 'title', extraFilter: { sourceKey: null } },
};

function hiddenFilter(scope: RequestScope, fields: string[] = []): Record<string, unknown> {
  if (scope.hiddenAccountIds.length === 0 || fields.length === 0) return {};
  return Object.fromEntries(fields.map((f) => [f, { $nin: scope.hiddenAccountIds }]));
}

async function listSimple(scope: RequestScope, type: keyof typeof SIMPLE, search: RegExp | null, now: Date): Promise<Listed[]> {
  const spec = SIMPLE[type];
  const rows = await spec.model
    .find({
      workspaceId: scope.workspaceId,
      deletedAt: inTrash(now),
      ...(spec.retainable ? { trashRetainedAt: null } : {}),
      ...spec.extraFilter,
      ...hiddenFilter(scope, spec.hiddenBy),
      ...(search ? { [spec.nameField]: search } : {}),
    })
    .sort({ deletedAt: -1 })
    .limit(LIST_CAP_PER_TYPE)
    .lean<Array<Record<string, unknown>>>();
  return rows.map((r) => ({ id: String(r._id), name: String(r[spec.nameField] ?? ''), deletedAt: r.deletedAt as Date }));
}

function listType(scope: RequestScope, type: TrashItemType, search: RegExp | null, now: Date): Promise<Listed[]> {
  if (type === 'transaction') return listTransactions(scope, search, now);
  if (type === 'document') return listDocuments(scope, search, now);
  return listSimple(scope, type, search, now);
}

export interface TrashListOptions {
  type?: TrashItemType;
  q?: string;
  page: number;
  limit: number;
}

/** Everything in Trash, newest deletion first, across every supported type. */
export async function listTrash(scope: RequestScope, options: TrashListOptions, now: Date = new Date()): Promise<{ items: TrashItemDto[]; total: number }> {
  const search = options.q?.trim() ? new RegExp(escapeRegex(options.q.trim()), 'i') : null;
  const types = options.type ? [options.type] : [...TRASH_ITEM_TYPES];
  const groups = await Promise.all(types.map(async (type) => (await listType(scope, type, search, now)).map((item) => ({ ...item, type }))));

  const all = groups.flat().sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime() || a.id.localeCompare(b.id));
  const start = (options.page - 1) * options.limit;
  const items = all.slice(start, start + options.limit).map(
    (item): TrashItemDto => ({
      id: item.id,
      type: item.type,
      name: item.name,
      detail: item.detail,
      date: item.date?.toISOString(),
      amountMinor: item.amountMinor,
      currency: item.currency,
      transactionType: item.transactionType,
      deletedAt: item.deletedAt.toISOString(),
      expiresAt: trashExpiresAt(item.deletedAt).toISOString(),
      daysRemaining: trashDaysRemaining(item.deletedAt, now),
    }),
  );
  return { items, total: all.length };
}

// ─────────────────────────────────────────────── Restore

const expired = () => conflict('This item has been in Trash for more than 30 days and can no longer be restored.', 'TRASH_EXPIRED');

/** Restore one item, putting back its effect exactly once. */
export async function restoreTrashItem(scope: RequestScope, type: TrashItemType, id: string, audit: AuditContext, now: Date = new Date()): Promise<void> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Item');

  if (type === 'transaction') {
    const row = await Transaction.findOne({ _id: id, workspaceId: scope.workspaceId, deletedAt: { $ne: null } }).select('deletedAt trashRetainedAt').lean();
    if (!row) throw notFound('Item');
    if (row.trashRetainedAt || row.deletedAt! <= trashCutoff(now)) throw expired();
    await restoreTransaction(scope, id, audit); // atomic, re-checks everything, re-applies the money once
    return;
  }
  if (type === 'document') {
    const row = await Attachment.findOne({ _id: id, workspaceId: scope.workspaceId, deletedAt: { $ne: null } }).select('deletedAt').lean();
    if (!row) throw notFound('Item');
    if (row.deletedAt! <= trashCutoff(now)) throw expired();
    await restoreAttachment(scope, id, audit);
    return;
  }

  const spec = SIMPLE[type];
  const doc = await spec.model
    .findOne({ _id: id, workspaceId: scope.workspaceId, deletedAt: { $ne: null }, ...spec.extraFilter, ...hiddenFilter(scope, spec.hiddenBy) })
    .lean<Record<string, unknown>>();
  if (!doc) throw notFound('Item');
  if (doc.trashRetainedAt || (doc.deletedAt as Date) <= trashCutoff(now)) throw expired();

  const set: Record<string, unknown> = { deletedAt: null, deletedBy: null };
  if (type === 'account' || type === 'group' || type === 'budget') set.isActive = true;
  if (type === 'recurring') {
    set.isActive = true;
    // Occurrences that fell due while it was in Trash are skipped, never back-posted:
    // restoring must not create a burst of transactions nobody asked for.
    let next = new Date(doc.nextRunDate as Date);
    for (let i = 0; next < now && i < 5000; i++) next = computeNextRun(doc as never, next);
    set.nextRunDate = next;
  }

  try {
    // Conditional on the exact deletion we read: a concurrent restore or purge makes this a no-op.
    const result = await spec.model.updateOne({ _id: doc._id, workspaceId: scope.workspaceId, deletedAt: doc.deletedAt }, { $set: set });
    if (result.modifiedCount === 0) throw notFound('Item');
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw conflict('Something active already has the same name. Rename or remove it, then restore this.', 'TRASH_NAME_TAKEN');
    }
    throw err;
  }

  await recordAudit(audit, {
    action: 'restored',
    entityType: modelName(type),
    entityId: doc._id as Types.ObjectId,
    summary: `Restored "${String(doc[spec.nameField] ?? '')}" from Trash`,
  });
}

/** Restore several items; each succeeds or fails on its own, and the result says which. */
export async function restoreTrashItems(
  scope: RequestScope,
  items: Array<{ type: TrashItemType; id: string }>,
  audit: AuditContext,
): Promise<TrashRestoreResultDto[]> {
  const results: TrashRestoreResultDto[] = [];
  for (const item of items) {
    try {
      await restoreTrashItem(scope, item.type, item.id, audit);
      results.push({ ...item, ok: true });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      results.push({ ...item, ok: false, error: err.message, code: err.code });
    }
  }
  return results;
}

// ─────────────────────────────────────────────── Permanent deletion

function modelName(type: TrashItemType): string {
  return {
    transaction: 'Transaction',
    account: 'Account',
    person: 'Person',
    group: 'ExpenseGroup',
    budget: 'Budget',
    goal: 'SavingsGoal',
    recurring: 'RecurringTransaction',
    reminder: 'Reminder',
    document: 'Attachment',
  }[type];
}

/**
 * Whether anything still points at this record. `live` blocks erasing it for good; `inTrash`
 * only means "not yet" — those records are on their own way out, so try again next run.
 */
async function references(type: 'transaction' | 'account' | 'person', id: Types.ObjectId): Promise<{ live: boolean; inTrash: boolean }> {
  type Check = [AnyModel, Record<string, unknown>, boolean]; // model, filter, model has deletedAt
  const checks: Check[] =
    type === 'transaction'
      ? [
          [Transaction, { $or: [{ parentTransactionId: id }, { 'reimbursement.payoutTransactionId': id }] }, true],
          [InstallmentPlan, { transactionId: id }, false],
          [Invoice, { paidTransactionId: id }, true],
          [DayClosing, { adjustmentTransactionId: id }, false],
          [SavingsGoal, { 'contributions.transactionId': id }, true],
        ]
      : type === 'account'
        ? [
            [Transaction, { 'postings.accountId': id }, true],
            [Budget, { accountId: id }, true],
            [SavingsGoal, { linkedAccountId: id }, true],
            [RecurringTransaction, { $or: [{ accountId: id }, { toAccountId: id }] }, true],
            [GroupExpense, { accountId: id }, true],
            [GroupSettlement, { accountId: id }, true],
            [Attachment, { accountId: id }, true],
            [Invoice, { accountId: id }, true],
            [Payee, { defaultAccountId: id }, false],
            [ImportProfile, { defaultAccountId: id }, false],
            [PettyCash, { $or: [{ accountId: id }, { replenishFromAccountId: id }] }, false],
            [DayClosing, { accountIds: id }, false],
          ]
        : [
            [Transaction, { personId: id }, true],
            [ExpenseGroup, { memberPersonIds: id }, true],
            [GroupExpense, { $or: [{ paidByPersonId: id }, { 'memberShares.personId': id }, { 'splitInputs.personId': id }] }, true],
            [GroupSettlement, { $or: [{ fromPersonId: id }, { toPersonId: id }] }, true],
            [RecurringTransaction, { personId: id }, true],
            [Reminder, { personId: id }, true],
            [Invoice, { personId: id }, true],
            [Quotation, { personId: id }, true],
            [Project, { personId: id }, true],
          ];

  let inTrashRef = false;
  for (const [model, filter, softDeletes] of checks) {
    // A path a model doesn't define is simply not there (strictQuery): counts as no reference.
    if (Object.keys(filter).some((k) => k !== '$or' && !model.schema.path(k.split('.')[0]!))) continue;
    if (!softDeletes) {
      if (await model.exists(filter)) return { live: true, inTrash: false };
      continue;
    }
    if (await model.exists({ ...filter, deletedAt: null })) return { live: true, inTrash: false };
    if (!inTrashRef && (await model.exists({ ...filter, deletedAt: { $ne: null } }))) inTrashRef = true;
  }
  return { live: false, inTrash: inTrashRef };
}

/**
 * Permanently delete one record that is in Trash. `expiredOnly` (the scheduler) limits it to
 * records whose 30 days are up; without it (on request) any record in Trash qualifies.
 */
async function purgeOne(
  type: TrashItemType,
  id: Types.ObjectId,
  options: { expiredOnly: boolean; now: Date; workspaceId?: Types.ObjectId },
): Promise<Outcome> {
  const cutoff = trashCutoff(options.now);
  const deletedAt = options.expiredOnly ? { $ne: null, $lte: cutoff } : { $ne: null };
  const scoped = options.workspaceId ? { workspaceId: options.workspaceId } : {};

  if (type === 'document') {
    const attachment = await Attachment.findOne({ _id: id, deletedAt, ...scoped });
    if (!attachment) return 'missing';
    return (await eraseAttachment(attachment, { deletedAt })) ? auditPurge(type, attachment, attachment.title || attachment.fileName) : 'waiting';
  }

  const model: AnyModel = type === 'transaction' ? Transaction : SIMPLE[type].model;
  const retainable = type === 'transaction' || type === 'account' || type === 'person';
  const filter = { _id: id, deletedAt, ...scoped, ...(retainable ? { trashRetainedAt: null } : {}) };
  const doc = await model.findOne(filter).lean<Record<string, unknown>>();
  if (!doc) return 'missing';

  if (retainable) {
    const refs = await references(type as 'transaction' | 'account' | 'person', doc._id as Types.ObjectId);
    if (refs.live) {
      // Kept for the records that still point to it. Only the scheduler marks it — and only
      // once its time is up — after which it leaves Trash and is no longer restorable.
      if (options.expiredOnly) await model.updateOne(filter, { $set: { trashRetainedAt: options.now } });
      return 'kept';
    }
    if (refs.inTrash) return 'waiting';
  }

  const removed = await model.deleteOne(filter);
  if (removed.deletedCount === 0) return 'missing'; // restored or purged by someone else meanwhile

  if (type === 'transaction') {
    // Its receipts go with it: due for purge from now on, and erased straight away where possible.
    const due = new Date(cutoff.getTime() - 1000);
    await Attachment.updateMany({ transactionId: doc._id }, { $set: { deletedAt: due } });
    const receipts = await Attachment.find({ transactionId: doc._id });
    for (const receipt of receipts) await eraseAttachment(receipt, { deletedAt: { $ne: null } });
  }
  if (type === 'group') {
    // The group's own record of who paid what goes with it. The entries those expenses and
    // payments made in your books are real money and stay exactly where they are.
    await GroupExpense.deleteMany({ groupId: doc._id, workspaceId: doc.workspaceId });
    await GroupSettlement.deleteMany({ groupId: doc._id, workspaceId: doc.workspaceId });
  }

  return auditPurge(type, doc as { _id: Types.ObjectId; userId: Types.ObjectId; workspaceId: Types.ObjectId }, String(doc[type === 'transaction' ? 'description' : SIMPLE[type as keyof typeof SIMPLE].nameField] ?? ''));
}

async function auditPurge(type: TrashItemType, doc: { _id: Types.ObjectId; userId: Types.ObjectId; workspaceId: Types.ObjectId }, name: string): Promise<'purged'> {
  await recordAudit(
    { userId: doc.userId, workspaceId: doc.workspaceId },
    {
      action: 'deleted',
      entityType: modelName(type),
      entityId: doc._id,
      summary: `Permanently deleted "${name}" from Trash`.slice(0, 300),
    },
  ).catch((err) => logger.warn({ err }, 'Could not record a Trash purge in the audit log'));
  return 'purged';
}

function assertCanPermanentlyDelete(scope: RequestScope) {
  if (scope.role !== 'owner' && scope.role !== 'admin') {
    throw forbidden('Only the workspace owner or an admin can permanently delete items.');
  }
}

/** "Delete forever" on one item, by request. */
export async function deleteTrashItem(scope: RequestScope, type: TrashItemType, id: string, now: Date = new Date()): Promise<void> {
  assertCanPermanentlyDelete(scope);
  if (!Types.ObjectId.isValid(id)) throw notFound('Item');
  // Only what this caller can see in Trash can be erased by them.
  const visible = (await listType(scope, type, null, now)).some((item) => item.id === id);
  if (!visible) throw notFound('Item');

  const outcome = await purgeOne(type, new Types.ObjectId(id), { expiredOnly: false, now, workspaceId: scope.workspaceId });
  if (outcome === 'kept' || outcome === 'waiting') {
    throw conflict(
      'Other records still refer to this, so it can’t be permanently deleted yet. It stays in Trash until its 30 days are up.',
      'TRASH_ITEM_IN_USE',
    );
  }
  if (outcome === 'missing') throw notFound('Item');
}

/** "Empty Trash": permanently delete everything this caller can see in Trash that nothing else needs. */
export async function emptyTrash(scope: RequestScope, now: Date = new Date()): Promise<{ deleted: number; kept: number }> {
  assertCanPermanentlyDelete(scope);
  let deleted = 0;
  let kept = 0;
  // Dependents before what they depend on: a transaction before its account or person.
  for (const type of PURGE_ORDER) {
    for (const item of await listType(scope, type, null, now)) {
      const outcome = await purgeOne(type, new Types.ObjectId(item.id), { expiredOnly: false, now, workspaceId: scope.workspaceId });
      if (outcome === 'purged') deleted++;
      else if (outcome === 'kept' || outcome === 'waiting') kept++;
    }
  }
  return { deleted, kept };
}

// ─────────────────────────────────────────────── Automatic purge

const PURGE_ORDER: TrashItemType[] = ['transaction', 'document', 'group', 'budget', 'goal', 'recurring', 'reminder', 'person', 'account'];

/**
 * The safe start line for automatic purging (a reversible migration). Transactions, accounts and
 * people could be soft-deleted before Trash existed, under a promise that nothing was ever
 * hard-deleted, and anything deleted more than 30 days before this deployment first ran the
 * purge was never shown in Trash — so it is never purged automatically. It stays soft-deleted
 * exactly as before. The launch time is recorded once (atomic upsert), so every process agrees.
 */
async function legacyFloor(now: Date): Promise<Date> {
  const marker = await SystemMarker.findOneAndUpdate(
    { key: 'trash.launchedAt' },
    { $setOnInsert: { key: 'trash.launchedAt', at: now } },
    { upsert: true, new: true },
  ).lean();
  return trashCutoff(marker!.at);
}

export interface PurgeStats {
  purged: number;
  kept: number;
  waiting: number;
  failed: number;
}

/**
 * The scheduler's sweep: permanently delete everything whose 30 days in Trash are up, across
 * every workspace. Safe to run as often as you like and from several processes at once —
 * each delete is conditional, so a record is only ever removed once and a restore that wins
 * the race is never undone. One record failing (storage down, say) is logged and left for
 * the next run; it never stops the rest. Work per run is capped so a large backlog drains
 * over several runs instead of holding the scheduler up.
 */
export async function purgeExpiredTrash(now: Date = new Date()): Promise<PurgeStats> {
  const stats: PurgeStats = { purged: 0, kept: 0, waiting: 0, failed: 0 };
  const cutoff = trashCutoff(now);
  const floor = await legacyFloor(now);

  for (const type of PURGE_ORDER) {
    const model: AnyModel = type === 'transaction' ? Transaction : type === 'document' ? Attachment : SIMPLE[type].model;
    const retainable = type === 'transaction' || type === 'account' || type === 'person';
    let lastId: Types.ObjectId | null = null;
    let processed = 0;

    while (processed < PURGE_CAP_PER_TYPE) {
      const batch: Array<{ _id: Types.ObjectId }> = await model
        .find({
          // Transactions, accounts and people deleted before Trash existed (and never shown in
          // it) are left alone; see `legacyFloor`.
          deletedAt: { $ne: null, $lte: cutoff, ...(retainable ? { $gt: floor } : {}) },
          ...(retainable ? { trashRetainedAt: null } : {}),
          ...(lastId ? { _id: { $gt: lastId } } : {}),
        })
        .sort({ _id: 1 })
        .limit(PURGE_BATCH)
        .select('_id')
        .lean<Array<{ _id: Types.ObjectId }>>();
      if (batch.length === 0) break;

      for (const row of batch) {
        try {
          const outcome = await purgeOne(type, row._id, { expiredOnly: true, now });
          if (outcome !== 'missing') stats[outcome === 'purged' ? 'purged' : outcome]++;
        } catch (err) {
          stats.failed++;
          logger.error({ err, type, id: String(row._id) }, 'Trash purge failed for one item; will retry next run');
        }
      }
      processed += batch.length;
      lastId = batch[batch.length - 1]!._id;
      if (batch.length < PURGE_BATCH) break;
    }
  }

  if (stats.purged || stats.kept || stats.failed) logger.info({ ...stats }, 'Trash purge finished');
  return stats;
}
