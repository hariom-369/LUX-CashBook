import { Types, type HydratedDocument } from 'mongoose';
import {
  addDays,
  addMonths,
  addYears,
  daysInMonth,
  type PaymentMethod,
  type RecurrenceFrequency,
  type RecurringTransactionDto,
  type TransactionType,
} from '@khata/shared';
import { Account, Category, Person, RecurringTransaction, type IRecurringTransaction } from '../../models/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';
import { createTransaction } from '../transactions/transaction.service.js';
import { logger } from '../../lib/logger.js';

export type RecurringDoc = HydratedDocument<IRecurringTransaction>;

export function toRecurringDto(
  recurring: IRecurringTransaction,
  accountName?: string,
  categoryName?: string,
): RecurringTransactionDto {
  return {
    id: String(recurring._id),
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
}

async function assertAccount(scope: RequestScope, accountId: string) {
  if (!Types.ObjectId.isValid(accountId)) throw notFound('Account');
  const account = await Account.findOne({ _id: accountId, workspaceId: scope.workspaceId, deletedAt: null }).lean();
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
  if (!recurring) throw notFound('Recurring transaction');
  return recurring;
}

export async function updateRecurring(
  scope: RequestScope,
  id: string,
  input: Partial<CreateRecurringInput> & { isPaused?: boolean },
  audit: AuditContext,
): Promise<RecurringDoc> {
  const recurring = await getRecurringDoc(scope, id);

  for (const key of [
    'name', 'amountMinor', 'accountId', 'toAccountId', 'categoryId', 'personId', 'description',
    'paymentMethod', 'frequency', 'intervalDays', 'dayOfWeek', 'dayOfMonth', 'monthOfYear',
    'endDate', 'autoPost', 'reminderDaysBefore', 'maxOccurrences', 'isPaused',
  ] as const) {
    if (input[key] !== undefined) (recurring as unknown as Record<string, unknown>)[key] = input[key];
  }

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
  const rows = await RecurringTransaction.find({ workspaceId: scope.workspaceId, isActive: true })
    .sort({ nextRunDate: 1 })
    .lean();
  if (rows.length === 0) return [];

  const accountIds = new Set(rows.map((r) => String(r.accountId)));
  const categoryIds = new Set(rows.map((r) => r.categoryId).filter(Boolean).map(String));

  const [accounts, categories] = await Promise.all([
    Account.find({ _id: { $in: [...accountIds] } }).select('name').lean(),
    categoryIds.size ? Category.find({ _id: { $in: [...categoryIds] } }).select('name').lean() : [],
  ]);
  const accountName = new Map(accounts.map((a) => [String(a._id), a.name]));
  const categoryName = new Map(categories.map((c) => [String(c._id), c.name]));

  return rows.map((r) =>
    toRecurringDto(r, accountName.get(String(r.accountId)), r.categoryId ? categoryName.get(String(r.categoryId)) : undefined),
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
