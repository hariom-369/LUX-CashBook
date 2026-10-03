import { Types, type HydratedDocument } from 'mongoose';
import {
  addDays,
  addMonths,
  addYears,
  daysInMonth,
  type BillKind,
  type PaymentMethod,
  type RecurrenceFrequency,
  type RecurringTransactionDto,
  type TransactionType,
} from '@khata/shared';
import { Account, Category, Payee, Person, RecurringTransaction, type IRecurringTransaction } from '../../models/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';
import { createTransaction } from '../transactions/transaction.service.js';
import { logger } from '../../lib/logger.js';
import { claimRevision } from '../../lib/revision.js';
import { visibleAccountIds } from '../../services/accountVisibility.js';

export type RecurringDoc = HydratedDocument<IRecurringTransaction>;

export function toRecurringDto(
  recurring: IRecurringTransaction,
  accountName?: string,
  categoryName?: string,
  payeeName?: string,
): RecurringTransactionDto {
  return {
    id: String(recurring._id),
    rev: recurring.rev,
    workspaceId: String(recurring.workspaceId),
    name: recurring.name,
    type: recurring.type,
    amountMinor: recurring.amountMinor,
    accountId: String(recurring.accountId),
    accountName,
    toAccountId: recurring.toAccountId ? String(recurring.toAccountId) : undefined,
    categoryId: recurring.categoryId ? String(recurring.categoryId) : undefined,
    categoryName,
    personId: recurring.personId ? String(recurring.personId) : undefined,
    payeeId: recurring.payeeId ? String(recurring.payeeId) : undefined,
    payeeName,
    description: recurring.description,
    frequency: recurring.frequency,
    intervalDays: recurring.intervalDays ?? undefined,
    dayOfWeek: recurring.dayOfWeek ?? undefined,
    dayOfMonth: recurring.dayOfMonth ?? undefined,
    monthOfYear: recurring.monthOfYear ?? undefined,
    startDate: recurring.startDate.toISOString(),
    endDate: recurring.endDate?.toISOString(),
    nextRunDate: recurring.nextRunDate.toISOString(),
    lastRunDate: recurring.lastRunDate?.toISOString(),
    autoPost: recurring.autoPost,
    reminderDaysBefore: recurring.reminderDaysBefore,
    isActive: recurring.isActive && !recurring.isPaused,
    occurrencesCreated: recurring.occurrencesCreated,
    maxOccurrences: recurring.maxOccurrences ?? undefined,
    billKind: recurring.billKind ?? undefined,
  };
}

/**
 * Advance a schedule to its next occurrence.
 *
 * This is the one function the scheduler and the create/preview paths both call, so
 * "what date comes next" has exactly one implementation. Monthly and yearly clamp
 * to the target day-of-month via `addMonths`/`addYears` (31 Jan + 1 month = 28/29
 * Feb, not 2/3 Mar), which is the behaviour a salary or rent date actually needs.
 */
export function computeNextRun(
  schedule: Pick<IRecurringTransaction, 'frequency' | 'intervalDays' | 'dayOfWeek' | 'dayOfMonth' | 'monthOfYear'>,
  from: Date,
): Date {
  switch (schedule.frequency) {
    case 'daily':
      return addDays(from, 1);
    case 'weekly':
      return addDays(from, 7);
    case 'monthly': {
      const next = addMonths(from, 1);
      if (schedule.dayOfMonth) {
        next.setDate(Math.min(schedule.dayOfMonth, daysInMonth(next.getFullYear(), next.getMonth())));
      }
      return next;
    }
    case 'yearly': {
      const next = addYears(from, 1);
      if (schedule.monthOfYear) next.setMonth(schedule.monthOfYear - 1);
      if (schedule.dayOfMonth) {
        next.setDate(Math.min(schedule.dayOfMonth, daysInMonth(next.getFullYear(), next.getMonth())));
      }
      return next;
    }
    case 'custom':
    default:
      return addDays(from, schedule.intervalDays ?? 30);
  }
}

export interface CreateRecurringInput {
  name: string;
  type: TransactionType;
  amountMinor: number;
  accountId: string;
  toAccountId?: string;
  categoryId?: string | null;
  personId?: string | null;
  payeeId?: string | null;
  description?: string;
  paymentMethod?: PaymentMethod;
  frequency: RecurrenceFrequency;
  intervalDays?: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  monthOfYear?: number;
  startDate: Date;
  endDate?: Date | null;
  autoPost?: boolean;
  reminderDaysBefore?: number;
  maxOccurrences?: number | null;
  billKind?: BillKind | null;
}

async function assertAccount(scope: RequestScope, accountId: string) {
  if (!Types.ObjectId.isValid(accountId)) throw notFound('Account');
  const account = await Account.findOne({ _id: visibleAccountIds(scope, accountId), workspaceId: scope.workspaceId, deletedAt: null }).lean();
  if (!account) throw notFound('Account');
  return account;
}

export async function createRecurring(
  scope: RequestScope,
  input: CreateRecurringInput,
  audit: AuditContext,
): Promise<RecurringDoc> {
  await assertAccount(scope, input.accountId);
  if (input.toAccountId) await assertAccount(scope, input.toAccountId);

  if (input.categoryId) {
    if (!Types.ObjectId.isValid(input.categoryId)) throw notFound('Category');
    const category = await Category.findOne({ _id: input.categoryId, workspaceId: scope.workspaceId }).lean();
    if (!category) throw notFound('Category');
  }
  if (input.personId) {
    if (!Types.ObjectId.isValid(input.personId)) throw notFound('Person');
    const person = await Person.findOne({ _id: input.personId, workspaceId: scope.workspaceId, deletedAt: null }).lean();
    if (!person) throw notFound('Person');
  }
  if (input.payeeId) {
    if (!Types.ObjectId.isValid(input.payeeId)) throw notFound('Payee');
    const payee = await Payee.findOne({ _id: input.payeeId, workspaceId: scope.workspaceId }).lean();
    if (!payee) throw notFound('Payee');
  }

  const recurring = await RecurringTransaction.create({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    name: input.name.trim(),
    type: input.type,
    amountMinor: input.amountMinor,
    accountId: input.accountId,
    toAccountId: input.toAccountId,
    categoryId: input.categoryId,
    personId: input.personId,
    payeeId: input.payeeId,
    description: input.description?.trim() ?? '',
    paymentMethod: input.paymentMethod,
    frequency: input.frequency,
    intervalDays: input.intervalDays,
    dayOfWeek: input.dayOfWeek,
    dayOfMonth: input.dayOfMonth,
    monthOfYear: input.monthOfYear,
    startDate: input.startDate,
    endDate: input.endDate,
    nextRunDate: input.startDate,
    autoPost: input.autoPost ?? true,
    reminderDaysBefore: input.reminderDaysBefore ?? 1,
    maxOccurrences: input.maxOccurrences,
    billKind: input.billKind,
  });

  await recordAudit(audit, {
    action: 'created',
    entityType: 'RecurringTransaction',
    entityId: recurring._id,
    summary: `Created recurring "${recurring.name}"`,
  });

  return recurring;
}

async function getRecurringDoc(scope: RequestScope, id: string): Promise<RecurringDoc> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Recurring transaction');
  const recurring = await RecurringTransaction.findOne({ _id: id, workspaceId: scope.workspaceId });
  const hidden = scope.hiddenAccountIds;
  if (!recurring || hidden.some((h) => h.equals(recurring.accountId) || (recurring.toAccountId && h.equals(recurring.toAccountId)))) {
    throw notFound('Recurring transaction');
  }
  return recurring;
}

export async function updateRecurring(
  scope: RequestScope,
  id: string,
  input: Partial<CreateRecurringInput> & { isPaused?: boolean },
  audit: AuditContext,
  /** The `rev` the editor read; see lib/revision.ts. */
  expectedRev?: number,
): Promise<RecurringDoc> {
  const recurring = await getRecurringDoc(scope, id);

  for (const key of [
    'name', 'amountMinor', 'accountId', 'toAccountId', 'categoryId', 'personId', 'payeeId', 'description',
    'paymentMethod', 'frequency', 'intervalDays', 'dayOfWeek', 'dayOfMonth', 'monthOfYear',
    'endDate', 'autoPost', 'reminderDaysBefore', 'maxOccurrences', 'isPaused', 'billKind',
  ] as const) {
    if (input[key] !== undefined) (recurring as unknown as Record<string, unknown>)[key] = input[key];
  }

  await claimRevision(RecurringTransaction, recurring, expectedRev);
  await recurring.save();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'RecurringTransaction',
    entityId: recurring._id,
    summary: `Updated recurring "${recurring.name}"`,
  });

  return recurring;
}

export async function deleteRecurring(scope: RequestScope, id: string, audit: AuditContext): Promise<void> {
  const recurring = await getRecurringDoc(scope, id);
  recurring.isActive = false;
  await recurring.save();

  await recordAudit(audit, {
    action: 'deleted',
    entityType: 'RecurringTransaction',
    entityId: recurring._id,
    summary: `Removed recurring "${recurring.name}"`,
  });
}

export async function listRecurring(scope: RequestScope): Promise<RecurringTransactionDto[]> {
  const rows = await RecurringTransaction.find({
    workspaceId: scope.workspaceId,
    isActive: true,
    ...(scope.hiddenAccountIds.length > 0
      ? { accountId: { $nin: scope.hiddenAccountIds }, toAccountId: { $nin: scope.hiddenAccountIds } }
      : {}),
  })
    .sort({ nextRunDate: 1 })
    .lean();
  if (rows.length === 0) return [];

  const accountIds = new Set(rows.map((r) => String(r.accountId)));
  const categoryIds = new Set(rows.map((r) => r.categoryId).filter(Boolean).map(String));
  const payeeIds = new Set(rows.map((r) => r.payeeId).filter(Boolean).map(String));

  const [accounts, categories, payees] = await Promise.all([
    Account.find({ _id: { $in: [...accountIds] } }).select('name').lean(),
    categoryIds.size ? Category.find({ _id: { $in: [...categoryIds] } }).select('name').lean() : [],
    payeeIds.size ? Payee.find({ _id: { $in: [...payeeIds] } }).select('name').lean() : [],
  ]);
  const accountName = new Map(accounts.map((a) => [String(a._id), a.name]));
  const categoryName = new Map(categories.map((c) => [String(c._id), c.name]));
  const payeeName = new Map(payees.map((p) => [String(p._id), p.name]));

  return rows.map((r) =>
    toRecurringDto(
      r,
      accountName.get(String(r.accountId)),
      r.categoryId ? categoryName.get(String(r.categoryId)) : undefined,
      r.payeeId ? payeeName.get(String(r.payeeId)) : undefined,
    ),
  );
}

/**
 * Post one occurrence immediately, whether or not it is due yet ("run now").
 * Advances `nextRunDate` exactly as the scheduler would, so a manual run and an
 * automatic one leave the template in the same state.
 */
export async function runRecurringNow(scope: RequestScope, id: string, audit: AuditContext): Promise<RecurringDoc> {
  const recurring = await getRecurringDoc(scope, id);
  if (!recurring.isActive || recurring.isPaused) {
    throw badRequest('This recurring transaction is not active.');
  }

  await postOccurrence(recurring, scope);

  await recordAudit(audit, {
    action: 'created',
    entityType: 'Transaction',
    entityId: recurring._id,
    summary: `Posted recurring "${recurring.name}" manually`,
  });

  return recurring;
}

/** Skip the upcoming occurrence without posting it — advance the schedule only. */
export async function skipNextOccurrence(scope: RequestScope, id: string, audit: AuditContext): Promise<RecurringDoc> {
  const recurring = await getRecurringDoc(scope, id);
  recurring.nextRunDate = computeNextRun(recurring, recurring.nextRunDate);
  await recurring.save();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'RecurringTransaction',
    entityId: recurring._id,
    summary: `Skipped an occurrence of "${recurring.name}"`,
  });

  return recurring;
}

async function postOccurrence(recurring: RecurringDoc, scope: RequestScope): Promise<void> {
  const systemAudit: AuditContext = { userId: scope.userId, workspaceId: scope.workspaceId };

  await createTransaction(
    scope,
    {
      type: recurring.type,
      amountMinor: recurring.amountMinor,
      date: recurring.nextRunDate,
      accountId: String(recurring.accountId),
      toAccountId: recurring.toAccountId ? String(recurring.toAccountId) : undefined,
      categoryId: recurring.categoryId ? String(recurring.categoryId) : undefined,
      personId: recurring.personId ? String(recurring.personId) : undefined,
      payeeId: recurring.payeeId ? String(recurring.payeeId) : undefined,
      description: recurring.description || recurring.name,
      paymentMethod: recurring.paymentMethod,
      recurringId: String(recurring._id),
      idempotencyKey: `recurring-${recurring._id}-${recurring.nextRunDate.toISOString().slice(0, 10)}`,
    },
    systemAudit,
  );

  recurring.lastRunDate = recurring.nextRunDate;
  recurring.occurrencesCreated += 1;
  recurring.nextRunDate = computeNextRun(recurring, recurring.nextRunDate);
  recurring.lastError = null;

  if (recurring.endDate && recurring.nextRunDate > recurring.endDate) {
    recurring.isActive = false;
  }
  if (recurring.maxOccurrences && recurring.occurrencesCreated >= recurring.maxOccurrences) {
    recurring.isActive = false;
  }

  await recurring.save();
}

/**
 * The scheduler tick (§21).
 *
 * Runs across every workspace, not one at a time by user request, because
 * recurring transactions post on their own schedule regardless of who is signed
 * in. Each due template is claimed with a conditional update on `nextRunDate`
 * before posting — the same date can't be claimed twice, so running this
 * concurrently (or restarting mid-run) can never post one occurrence twice.
 */
export async function processDueRecurring(now: Date = new Date()): Promise<{ posted: number; failed: number }> {
  let posted = 0;
  let failed = 0;

  // Bound the batch so one tick can't run forever if a backlog builds up.
  const due = await RecurringTransaction.find({
    isActive: true,
    isPaused: false,
    autoPost: true,
    nextRunDate: { $lte: now },
  })
    .limit(200)
    .lean();

  for (const template of due) {
    const claimedRunDate = template.nextRunDate;

    // Atomic claim: only proceeds if nextRunDate still matches what we read.
    const claimed = await RecurringTransaction.findOneAndUpdate(
      { _id: template._id, nextRunDate: claimedRunDate, isActive: true, isPaused: false },
      { $set: { nextRunDate: computeNextRun(template, claimedRunDate) } },
      { new: false },
    );
    if (!claimed) continue; // Another worker already claimed this occurrence.

    try {
      const scope = {
        userId: template.userId,
        workspaceId: template.workspaceId,
        currency: 'INR',
        mode: 'personal' as const,
        role: 'owner' as const,
        // Posting an occurrence writes the template owner's own entry; nothing is totalled or listed here.
        hiddenAccountIds: [] as Types.ObjectId[],
      };
      // Currency comes from the account, not a hardcoded default — resolve it.
      const account = await Account.findById(template.accountId).select('currency').lean();
      if (account) scope.currency = account.currency;

      const doc = (await RecurringTransaction.findById(template._id))!;
      // Restore the pre-claim date so postOccurrence advances from the correct
      // occurrence and records the right lastRunDate.
      doc.nextRunDate = claimedRunDate;
      await postOccurrence(doc, scope);
      posted++;
    } catch (err) {
      failed++;
      await RecurringTransaction.updateOne(
        { _id: template._id },
        { $set: { lastError: err instanceof Error ? err.message : 'Failed to post occurrence' } },
      );
      logger.error({ err, recurringId: String(template._id) }, 'Failed to post recurring transaction');
    }
  }

  if (posted > 0 || failed > 0) {
    logger.info({ posted, failed }, 'Recurring transaction sweep complete');
  }

  return { posted, failed };
}

/**
 * Notifications ahead of recurring occurrences — what the "Recurring reminders"
 * switch controls, and what the recurring form promises for remind-only items.
 *
 * - Auto-posting items: once per occurrence, `reminderDaysBefore` days ahead
 *   ("Rent posts in 2 days"). A lead of 0 means no advance notice.
 * - Remind-only items (`autoPost: false`) are never posted by the scheduler, so
 *   they get an advance notice and then a "confirm" notice once due, pointing at
 *   the Recurring page where the user runs or skips that occurrence.
 *
 * De-duplicated per occurrence date and stage, so a sweep that runs every five
 * minutes never repeats itself. Called by the scheduler.
 */
export async function raiseRecurringNotifications(now: Date = new Date()): Promise<number> {
  const { Notification } = await import('../../models/index.js');
  const { formatMoney, toDateKey } = await import('@khata/shared');
  const { isNotificationAllowed } = await import('../../services/notificationPolicy.js');
  const prefsCache = new Map();

  // `reminderDaysBefore` is at most 30 (see recurring.routes.ts).
  const cursor = RecurringTransaction.find({
    isActive: true,
    isPaused: false,
    nextRunDate: { $lte: addDays(now, 30) },
  })
    .lean()
    .cursor();

  let raised = 0;
  for await (const item of cursor) {
    const daysUntil = Math.round((item.nextRunDate.getTime() - now.getTime()) / 86_400_000);
    const isDue = daysUntil <= 0;

    let stage: 'upcoming' | 'due';
    if (item.autoPost) {
      if (item.reminderDaysBefore <= 0 || isDue || daysUntil > item.reminderDaysBefore) continue;
      stage = 'upcoming';
    } else {
      if (!isDue && daysUntil > item.reminderDaysBefore) continue;
      stage = isDue ? 'due' : 'upcoming';
    }

    if (!(await isNotificationAllowed(item.userId, 'recurringReminders', prefsCache))) continue;

    const amount = formatMoney(item.amountMinor, { compactDecimals: true });
    const when = daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
    const dedupeKey = `recurring:${item._id}:${toDateKey(item.nextRunDate)}:${stage}`;

    const content =
      stage === 'due'
        ? {
            title: `Confirm: ${item.name}`,
            body: `${amount} was due ${daysUntil === 0 ? 'today' : 'on ' + toDateKey(item.nextRunDate)}. Open Recurring to record it or skip it.`,
          }
        : item.autoPost
          ? { title: `${item.name} posts ${when}`, body: `${amount} will be recorded automatically.` }
          : { title: `${item.name} is due ${when}`, body: `${amount} — you'll confirm it yourself when it's due.` };

    const result = await Notification.updateOne(
      { userId: item.userId, dedupeKey },
      {
        $setOnInsert: {
          userId: item.userId,
          workspaceId: item.workspaceId,
          type: 'recurring_upcoming',
          ...content,
          icon: 'Repeat',
          link: '/recurring',
          amountMinor: item.amountMinor,
          dedupeKey,
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount > 0) {
      raised++;
      const { deliverPushToUser } = await import('../../services/pushDelivery.service.js');
      await deliverPushToUser(item.userId, { ...content, link: '/recurring' });
    }
  }

  return raised;
}
