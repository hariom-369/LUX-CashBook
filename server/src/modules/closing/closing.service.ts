import { Types, type HydratedDocument } from 'mongoose';
import { endOfDay, startOfDay, type DayClosingDto, type MonthClosingDto } from '@khata/shared';
import { Account, DayClosing, MonthClosing, Transaction, type IDayClosing, type IMonthClosing } from '../../models/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { createTransaction } from '../transactions/transaction.service.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';
import { getReceivablesAndPayables } from '../people/person.service.js';

export type DayClosingDoc = HydratedDocument<IDayClosing>;
export type MonthClosingDoc = HydratedDocument<IMonthClosing>;

function toDayClosingDto(record: IDayClosing): DayClosingDto {
  return {
    id: String(record._id),
    workspaceId: String(record.workspaceId),
    date: record.date.toISOString(),
    openingCashMinor: record.openingCashMinor,
    cashReceivedMinor: record.cashReceivedMinor,
    cashPaidMinor: record.cashPaidMinor,
    expectedClosingMinor: record.expectedClosingMinor,
    actualClosingMinor: record.actualClosingMinor,
    differenceMinor: record.differenceMinor,
    adjustmentTransactionId: record.adjustmentTransactionId ? String(record.adjustmentTransactionId) : undefined,
    note: record.note,
    closedAt: record.closedAt.toISOString(),
    closedBy: String(record.userId),
  };
}

/**
 * Preview the day's cash position before closing (§32).
 *
 * Opening cash plus everything received minus everything paid, computed the same
 * way the account ledger computes a running balance — so "what should be in the
 * drawer" is never a separately-maintained figure that could drift from the
 * transactions it's supposed to summarise.
 */
export async function previewDayClosing(
  scope: RequestScope,
  date: Date,
  accountIds?: string[],
): Promise<Omit<DayClosingDto, 'id' | 'workspaceId' | 'actualClosingMinor' | 'differenceMinor' | 'closedAt' | 'closedBy'>> {
  const cashAccounts = accountIds?.length
    ? await Account.find({ _id: { $in: accountIds }, workspaceId: scope.workspaceId }).lean()
    : await Account.find({ workspaceId: scope.workspaceId, type: 'cash', deletedAt: null }).lean();

  const accountObjectIds = cashAccounts.map((a) => a._id);
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const [openingAgg, dayAgg] = await Promise.all([
    Transaction.aggregate<{ total: number }>([
      { $match: { workspaceId: scope.workspaceId, deletedAt: null, date: { $lt: dayStart }, 'postings.accountId': { $in: accountObjectIds } } },
      { $unwind: '$postings' },
      { $match: { 'postings.accountId': { $in: accountObjectIds } } },
      { $group: { _id: null, total: { $sum: '$postings.amountMinor' } } },
    ]),
    Transaction.aggregate<{ total: number; type: 'in' | 'out' }>([
      { $match: { workspaceId: scope.workspaceId, deletedAt: null, date: { $gte: dayStart, $lte: dayEnd }, 'postings.accountId': { $in: accountObjectIds } } },
      { $unwind: '$postings' },
      { $match: { 'postings.accountId': { $in: accountObjectIds } } },
      { $group: { _id: { $cond: [{ $gt: ['$postings.amountMinor', 0] }, 'in', 'out'] }, total: { $sum: { $abs: '$postings.amountMinor' } } } },
      { $project: { type: '$_id', total: 1, _id: 0 } },
    ]),
  ]);

  const openingBase = cashAccounts.reduce((sum, a) => sum + a.openingBalanceMinor, 0);
  const openingCashMinor = openingBase + (openingAgg[0]?.total ?? 0);
  const cashReceivedMinor = dayAgg.find((r) => r.type === 'in')?.total ?? 0;
  const cashPaidMinor = dayAgg.find((r) => r.type === 'out')?.total ?? 0;

  return {
    date: date.toISOString(),
    openingCashMinor,
    cashReceivedMinor,
    cashPaidMinor,
    expectedClosingMinor: openingCashMinor + cashReceivedMinor - cashPaidMinor,
  };
}

export interface CloseDayInput {
  date: Date;
  actualClosingMinor: number;
  accountIds?: string[];
  note?: string;
  /** Post an adjustment transaction for the difference, if any. */
  postAdjustment?: boolean;
  adjustmentAccountId?: string;
}

export async function closeDay(scope: RequestScope, input: CloseDayInput, audit: AuditContext): Promise<DayClosingDto> {
  const day = startOfDay(input.date);

  const existing = await DayClosing.findOne({ workspaceId: scope.workspaceId, date: day });
  if (existing) throw conflict('This day has already been closed. Reopen it first to close it again.', 'DAY_ALREADY_CLOSED');

  const preview = await previewDayClosing(scope, input.date, input.accountIds);
  const differenceMinor = input.actualClosingMinor - preview.expectedClosingMinor;

  let adjustmentTransactionId: Types.ObjectId | undefined;

  if (differenceMinor !== 0 && input.postAdjustment) {
    if (!input.adjustmentAccountId) throw badRequest('Choose which account the difference should be adjusted on.');
    const transaction = await createTransaction(
      scope,
      {
        type: 'adjustment',
        amountMinor: Math.abs(differenceMinor),
        date: input.date,
        accountId: input.adjustmentAccountId,
        direction: differenceMinor > 0 ? 'in' : 'out',
        description: `Daily closing adjustment (${differenceMinor > 0 ? 'surplus' : 'shortfall'})`,
      },
      audit,
    );
    adjustmentTransactionId = transaction._id;
  }

  const record = await DayClosing.create({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    date: day,
    accountIds: input.accountIds,
    openingCashMinor: preview.openingCashMinor,
    cashReceivedMinor: preview.cashReceivedMinor,
    cashPaidMinor: preview.cashPaidMinor,
    expectedClosingMinor: preview.expectedClosingMinor,
    actualClosingMinor: input.actualClosingMinor,
    differenceMinor,
    adjustmentTransactionId,
    note: input.note,
  });

  await recordAudit(audit, {
    action: 'closed_day',
    entityType: 'DayClosing',
    entityId: record._id,
    summary: `Closed ${day.toDateString()} — difference ${differenceMinor}`,
  });

  return toDayClosingDto(record);
}

export async function reopenDay(scope: RequestScope, closingId: string, audit: AuditContext): Promise<void> {
  if (!Types.ObjectId.isValid(closingId)) throw notFound('Day closing');
  const record = await DayClosing.findOne({ _id: closingId, workspaceId: scope.workspaceId });
  if (!record) throw notFound('Day closing');

  record.reopenedAt = new Date();
  await record.save();
  await record.deleteOne();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'DayClosing',
    entityId: record._id,
    summary: `Reopened ${record.date.toDateString()}`,
  });
}

export async function listDayClosings(scope: RequestScope, limit = 30): Promise<DayClosingDto[]> {
  const records = await DayClosing.find({ workspaceId: scope.workspaceId }).sort({ date: -1 }).limit(limit);
  return records.map(toDayClosingDto);
}

// ─────────────────────────────────────────────── Month closing

function toMonthClosingDto(record: IMonthClosing): MonthClosingDto {
  return {
    id: String(record._id),
    workspaceId: String(record.workspaceId),
    year: record.year,
    month: record.month,
    openingBalanceMinor: record.openingBalanceMinor,
    totalReceiptsMinor: record.totalReceiptsMinor,
    totalPaymentsMinor: record.totalPaymentsMinor,
    closingBalanceMinor: record.closingBalanceMinor,
    incomeMinor: record.incomeMinor,
    expenseMinor: record.expenseMinor,
    transfersMinor: record.transfersMinor,
    receivablesMinor: record.receivablesMinor,
    payablesMinor: record.payablesMinor,
    closedAt: record.closedAt.toISOString(),
  };
}

/**
 * Close a month (§33).
 *
 * This freezes a summary and blocks *new writes* into that period — enforced by
 * `assertPeriodOpen` in the transaction service, checked on every create/update/
 * delete/restore — but it never touches a single historical transaction. The
 * numbers frozen here are a snapshot of what the ledger said at close time; the
 * ledger itself remains exactly as it was.
 */
export async function closeMonth(
  scope: RequestScope,
  year: number,
  month: number,
  note: string | undefined,
  audit: AuditContext,
): Promise<MonthClosingDto> {
  const existing = await MonthClosing.findOne({ workspaceId: scope.workspaceId, year, month, reopenedAt: null });
  if (existing) throw conflict('That month has already been closed.', 'MONTH_ALREADY_CLOSED');

  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59, 999);

  const [totals, receivablesPayables] = await Promise.all([
    Transaction.aggregate<{ _id: string; total: number }>([
      { $match: { workspaceId: scope.workspaceId, deletedAt: null, date: { $gte: from, $lte: to } } },
      { $group: { _id: '$type', total: { $sum: '$amountMinor' } } },
    ]),
    getReceivablesAndPayables(scope),
  ]);

  const totalByType = Object.fromEntries(totals.map((t) => [t._id, t.total]));
  const incomeMinor = totalByType.income ?? 0;
  const expenseMinor = totalByType.expense ?? 0;
  const transfersMinor = totalByType.transfer ?? 0;

  const openingBalanceAgg = await Transaction.aggregate<{ total: number }>([
    { $match: { workspaceId: scope.workspaceId, deletedAt: null, date: { $lt: from } } },
    { $unwind: '$postings' },
    { $group: { _id: null, total: { $sum: '$postings.amountMinor' } } },
  ]);
  const accounts = await Account.find({ workspaceId: scope.workspaceId }).select('openingBalanceMinor').lean();
  const openingBalanceMinor = accounts.reduce((s, a) => s + a.openingBalanceMinor, 0) + (openingBalanceAgg[0]?.total ?? 0);

  const closingAgg = await Transaction.aggregate<{ total: number }>([
    { $match: { workspaceId: scope.workspaceId, deletedAt: null, date: { $lte: to } } },
    { $unwind: '$postings' },
    { $group: { _id: null, total: { $sum: '$postings.amountMinor' } } },
  ]);
  const closingBalanceMinor = accounts.reduce((s, a) => s + a.openingBalanceMinor, 0) + (closingAgg[0]?.total ?? 0);

  const transactionCount = await Transaction.countDocuments({ workspaceId: scope.workspaceId, deletedAt: null, date: { $gte: from, $lte: to } });

  const record = await MonthClosing.create({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    year,
    month,
    openingBalanceMinor,
    totalReceiptsMinor: incomeMinor,
    totalPaymentsMinor: expenseMinor,
    closingBalanceMinor,
    incomeMinor,
    expenseMinor,
    transfersMinor,
    receivablesMinor: receivablesPayables.receivableMinor,
    payablesMinor: receivablesPayables.payableMinor,
    transactionCount,
    note,
  });

  await recordAudit(audit, {
    action: 'closed_month',
    entityType: 'MonthClosing',
    entityId: record._id,
    summary: `Closed ${month}/${year}`,
  });

  return toMonthClosingDto(record);
}

export async function reopenMonth(scope: RequestScope, closingId: string, audit: AuditContext): Promise<void> {
  if (!Types.ObjectId.isValid(closingId)) throw notFound('Month closing');
  const record = await MonthClosing.findOne({ _id: closingId, workspaceId: scope.workspaceId });
  if (!record) throw notFound('Month closing');

  await record.deleteOne();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'MonthClosing',
    entityId: record._id,
    summary: `Reopened ${record.month}/${record.year}`,
  });
}

export async function listMonthClosings(scope: RequestScope): Promise<MonthClosingDto[]> {
  const records = await MonthClosing.find({ workspaceId: scope.workspaceId }).sort({ year: -1, month: -1 });
  return records.map(toMonthClosingDto);
}
