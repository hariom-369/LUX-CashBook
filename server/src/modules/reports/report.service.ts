import { Types } from 'mongoose';
import {
  addMonths,
  endOfMonth,
  monthLabel,
  safePercent,
  startOfMonth,
  type CategoryReportRowDto,
  type NetWorthDto,
} from '@khata/shared';
import { Account, Category, Invoice, Person, Transaction } from '../../models/index.js';
import type { RequestScope } from '../../middleware/context.js';
import { getWorkspaceTotals } from '../../services/balance.service.js';
import { excludeHiddenAccounts, excludeHiddenTransactions, getHiddenPersonDeltas } from '../../services/accountVisibility.js';

/**
 * Reports (§27).
 *
 * Every report here is computed from live transactions at request time, for the
 * same reason the dashboard is: a report is a claim about what happened, and a
 * cached report can only be wrong the moment a transaction it depended on is
 * edited, deleted, or restored.
 */

// ─────────────────────────────────────────────── Category report

export async function getCategoryReport(
  scope: RequestScope,
  options: { from: Date; to: Date; kind: 'income' | 'expense' },
): Promise<CategoryReportRowDto[]> {
  const previousRange = shiftRangeBack(options.from, options.to);

  const [current, previous, categories] = await Promise.all([
    aggregateByCategory(scope, options.from, options.to, options.kind),
    aggregateByCategory(scope, previousRange.from, previousRange.to, options.kind),
    Category.find({ workspaceId: scope.workspaceId }).select('name icon color').lean(),
  ]);

  const categoryMeta = new Map(categories.map((c) => [String(c._id), c]));
  const total = current.reduce((sum, row) => sum + row.total, 0);
  const previousByCategory = new Map(previous.map((row) => [row.categoryId, row.total]));

  return current
    .map((row) => {
      const meta = row.categoryId ? categoryMeta.get(row.categoryId) : undefined;
      const previousAmount = previousByCategory.get(row.categoryId) ?? 0;
      return {
        categoryId: row.categoryId,
        name: meta?.name ?? 'Uncategorised',
        icon: meta?.icon ?? 'Circle',
        color: meta?.color ?? '#7E7A73',
        amountMinor: row.total,
        count: row.count,
        percentOfTotal: safePercent(row.total, total),
        previousAmountMinor: previousAmount,
        changePercent: previousAmount > 0 ? safePercent(row.total - previousAmount, previousAmount) : 0,
      };
    })
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

async function aggregateByCategory(
  scope: RequestScope,
  from: Date,
  to: Date,
  kind: 'income' | 'expense',
): Promise<Array<{ categoryId: string | null; total: number; count: number }>> {
  const rows = await Transaction.aggregate<{ _id: Types.ObjectId | null; total: number; count: number }>([
    {
      $match: {
        workspaceId: scope.workspaceId,
        deletedAt: null,
        type: kind,
        date: { $gte: from, $lte: to },
        ...excludeHiddenTransactions(scope),
      },
    },
    { $group: { _id: '$categoryId', total: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
  ]);
  return rows.map((row) => ({ categoryId: row._id ? String(row._id) : null, total: row.total, count: row.count }));
}

function shiftRangeBack(from: Date, to: Date): { from: Date; to: Date } {
  const spanMs = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - spanMs - 1), to: new Date(from.getTime() - 1) };
}

// ─────────────────────────────────────────────── Net worth

/**
 * Assets minus liabilities, plus receivables and payables (§31).
 *
 * Receivables count as an asset and payables as a liability — money someone owes
 * you is genuinely yours even though it isn't sitting in an account, and money you
 * owe genuinely reduces what you have, which is the whole point of tracking net
 * worth rather than just account balances.
 */
export async function getNetWorth(scope: RequestScope, months = 6): Promise<NetWorthDto> {
  const accounts = await Account.find({ workspaceId: scope.workspaceId, deletedAt: null, ...excludeHiddenAccounts(scope) }).lean();
  const people = await Person.find({ workspaceId: scope.workspaceId, deletedAt: null, isArchived: false }).lean();
  const hiddenDeltas = await getHiddenPersonDeltas(scope);

  const breakdown = { cashMinor: 0, bankMinor: 0, savingsMinor: 0, investmentMinor: 0, receivablesMinor: 0, creditCardMinor: 0, borrowingsMinor: 0, payablesMinor: 0 };

  for (const account of accounts) {
    if (account.excludeFromTotals) continue;
    const balance = account.cachedBalanceMinor;
    if (account.type === 'cash') breakdown.cashMinor += balance;
    else if (account.type === 'bank' || account.type === 'upi' || account.type === 'wallet') breakdown.bankMinor += balance;
    else if (account.type === 'savings') breakdown.savingsMinor += balance;
    else if (account.type === 'investment') breakdown.investmentMinor += balance;
    else if (account.type === 'credit_card') breakdown.creditCardMinor += Math.abs(Math.min(balance, 0));
    else breakdown.bankMinor += balance;
  }

  for (const person of people) {
    const balance = person.cachedBalanceMinor - (hiddenDeltas.get(String(person._id)) ?? 0);
    if (balance > 0) breakdown.receivablesMinor += balance;
    else breakdown.payablesMinor += Math.abs(balance);
  }

  const assetsMinor =
    breakdown.cashMinor + breakdown.bankMinor + breakdown.savingsMinor + breakdown.investmentMinor + breakdown.receivablesMinor;
  const liabilitiesMinor = breakdown.creditCardMinor + breakdown.borrowingsMinor + breakdown.payablesMinor;

  // Historical trend: reconstruct net worth at the end of each of the last N
  // months by replaying postings up to that point, rather than storing snapshots
  // that could drift from a since-edited transaction.
  const history = await buildNetWorthHistory(scope, months);

  return {
    assetsMinor,
    liabilitiesMinor,
    netWorthMinor: assetsMinor - liabilitiesMinor,
    breakdown,
    history,
  };
}

async function buildNetWorthHistory(
  scope: RequestScope,
  months: number,
): Promise<NetWorthDto['history']> {
  const now = new Date();
  const points: NetWorthDto['history'] = [];

  const accounts = await Account.find({ workspaceId: scope.workspaceId, excludeFromTotals: false, ...excludeHiddenAccounts(scope) })
    .select('openingBalanceMinor isLiability')
    .lean();

  for (let i = months - 1; i >= 0; i--) {
    const monthEnd = endOfMonth(addMonths(now, -i));

    const postingTotals = await Transaction.aggregate<{ _id: Types.ObjectId; total: number }>([
      { $match: { workspaceId: scope.workspaceId, deletedAt: null, date: { $lte: monthEnd } } },
      { $unwind: '$postings' },
      { $group: { _id: '$postings.accountId', total: { $sum: '$postings.amountMinor' } } },
    ]);
    const totalByAccount = new Map(postingTotals.map((row) => [String(row._id), row.total]));

    let assets = 0;
    let liabilities = 0;
    for (const account of accounts) {
      const balance = account.openingBalanceMinor + (totalByAccount.get(String(account._id)) ?? 0);
      if (account.isLiability) {
        liabilities += Math.abs(Math.min(balance, 0));
        assets += Math.max(balance, 0);
      } else {
        assets += balance;
      }
    }

    const personTotals = await Transaction.aggregate<{ total: number }>([
      { $match: { workspaceId: scope.workspaceId, deletedAt: null, date: { $lte: monthEnd }, personId: { $ne: null }, ...excludeHiddenTransactions(scope) } },
      { $group: { _id: '$personId', total: { $sum: '$personDeltaMinor' } } },
    ]);
    for (const row of personTotals) {
      if (row.total > 0) assets += row.total;
      else liabilities += Math.abs(row.total);
    }

    points.push({
      date: monthEnd.toISOString(),
      netWorthMinor: assets - liabilities,
      assetsMinor: assets,
      liabilitiesMinor: liabilities,
    });
  }

  return points;
}

// ─────────────────────────────────────────────── Monthly comparison / annual summary

export interface MonthSummaryRow {
  year: number;
  month: number;
  label: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  transferMinor: number;
}

export async function getMonthlyComparison(scope: RequestScope, monthsBack = 12): Promise<MonthSummaryRow[]> {
  const now = new Date();
  const from = startOfMonth(addMonths(now, -(monthsBack - 1)));

  const rows = await Transaction.aggregate<{
    _id: { year: number; month: number; type: string };
    total: number;
  }>([
    { $match: { workspaceId: scope.workspaceId, deletedAt: null, date: { $gte: from }, ...excludeHiddenTransactions(scope) } },
    {
      $group: {
        _id: { year: { $year: '$date' }, month: { $month: '$date' }, type: '$type' },
        total: { $sum: '$amountMinor' },
      },
    },
  ]);

  const byMonth = new Map<string, MonthSummaryRow>();
  for (let i = 0; i < monthsBack; i++) {
    const d = addMonths(from, i);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    byMonth.set(key, {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: monthLabel(d.getFullYear(), d.getMonth()),
      incomeMinor: 0,
      expenseMinor: 0,
      netMinor: 0,
      transferMinor: 0,
    });
  }

  for (const row of rows) {
    const key = `${row._id.year}-${row._id.month}`;
    const entry = byMonth.get(key);
    if (!entry) continue;
    if (row._id.type === 'income') entry.incomeMinor += row.total;
    else if (row._id.type === 'expense') entry.expenseMinor += row.total;
    else if (row._id.type === 'transfer') entry.transferMinor += row.total;
  }

  for (const entry of byMonth.values()) entry.netMinor = entry.incomeMinor - entry.expenseMinor;

  return [...byMonth.values()];
}

// ─────────────────────────────────────────────── Borrow/lend report

export interface BorrowLendRow {
  personId: string;
  personName: string;
  totalLentMinor: number;
  totalBorrowedMinor: number;
  totalRepaidToYouMinor: number;
  totalRepaidByYouMinor: number;
  outstandingMinor: number;
  status: 'receivable' | 'payable' | 'settled';
}

export async function getBorrowLendReport(scope: RequestScope): Promise<BorrowLendRow[]> {
  const people = await Person.find({ workspaceId: scope.workspaceId, deletedAt: null }).lean();
  if (people.length === 0) return [];
  const hiddenDeltas = await getHiddenPersonDeltas(scope);

  const rows = await Transaction.aggregate<{ _id: { personId: Types.ObjectId; type: string }; total: number }>([
    {
      $match: {
        workspaceId: scope.workspaceId,
        deletedAt: null,
        type: { $in: ['lend', 'borrow', 'repayment_given', 'repayment_received'] },
        ...excludeHiddenTransactions(scope),
      },
    },
    { $group: { _id: { personId: '$personId', type: '$type' }, total: { $sum: '$amountMinor' } } },
  ]);

  const byPerson = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const key = String(row._id.personId);
    const entry = byPerson.get(key) ?? {};
    entry[row._id.type] = row.total;
    byPerson.set(key, entry);
  }

  return people
    .map((person) => {
      const totals = byPerson.get(String(person._id)) ?? {};
      const lent = totals.lend ?? 0;
      const borrowed = totals.borrow ?? 0;
      const repaidToYou = totals.repayment_received ?? 0;
      const repaidByYou = totals.repayment_given ?? 0;
      const outstanding = person.cachedBalanceMinor - (hiddenDeltas.get(String(person._id)) ?? 0);

      return {
        personId: String(person._id),
        personName: person.name,
        totalLentMinor: lent,
        totalBorrowedMinor: borrowed,
        totalRepaidToYouMinor: repaidToYou,
        totalRepaidByYouMinor: repaidByYou,
        outstandingMinor: outstanding,
        status: (outstanding > 0 ? 'receivable' : outstanding < 0 ? 'payable' : 'settled') as BorrowLendRow['status'],
      };
    })
    .filter((row) => row.totalLentMinor || row.totalBorrowedMinor || row.outstandingMinor)
    .sort((a, b) => b.outstandingMinor - a.outstandingMinor);
}

// ─────────────────────────────────────────────── Income / expense statement

export interface StatementRow {
  categoryId: string | null;
  categoryName: string;
  amountMinor: number;
  count: number;
}

export async function getIncomeExpenseStatement(
  scope: RequestScope,
  kind: 'income' | 'expense',
  from: Date,
  to: Date,
): Promise<{ rows: StatementRow[]; totalMinor: number }> {
  const rows = await aggregateByCategory(scope, from, to, kind);
  const categories = await Category.find({ workspaceId: scope.workspaceId }).select('name').lean();
  const nameById = new Map(categories.map((c) => [String(c._id), c.name]));

  const statement = rows
    .map((row) => ({
      categoryId: row.categoryId,
      categoryName: row.categoryId ? (nameById.get(row.categoryId) ?? 'Uncategorised') : 'Uncategorised',
      amountMinor: row.total,
      count: row.count,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor);

  return { rows: statement, totalMinor: statement.reduce((sum, r) => sum + r.amountMinor, 0) };
}

/**
 * Profit & loss (§Phase 12) — composes the same income/expense statement
 * above for both sides plus a net line, rather than a parallel aggregation.
 * Revenue and expense are both "whatever the ordinary ledger already
 * categorises as income/expense" — there is no separate COGS concept yet
 * (see `docs/ROADMAP_PHASE12_NOTES.md` for why that's deferred).
 */
export async function getProfitAndLoss(
  scope: RequestScope,
  from: Date,
  to: Date,
): Promise<{
  from: string;
  to: string;
  income: { rows: StatementRow[]; totalMinor: number };
  expense: { rows: StatementRow[]; totalMinor: number };
  netProfitMinor: number;
}> {
  const [income, expense] = await Promise.all([
    getIncomeExpenseStatement(scope, 'income', from, to),
    getIncomeExpenseStatement(scope, 'expense', from, to),
  ]);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    income,
    expense,
    netProfitMinor: income.totalMinor - expense.totalMinor,
  };
}

// ─────────────────────────────────────────────── Receivables/payables ageing

export interface AgeingRow {
  personId: string;
  personName: string;
  source: 'invoice' | 'loan';
  referenceId: string;
  referenceLabel: string;
  dueDate: string;
  daysPastDue: number;
  bucket: 'not_due' | '0_30' | '31_60' | '61_90' | 'over_90';
  amountMinor: number;
}

function ageingBucket(daysPastDue: number): AgeingRow['bucket'] {
  if (daysPastDue <= 0) return 'not_due';
  if (daysPastDue <= 30) return '0_30';
  if (daysPastDue <= 60) return '31_60';
  if (daysPastDue <= 90) return '61_90';
  return 'over_90';
}

/**
 * Receivables (what customers/people owe you) or payables (what you owe
 * them) aged by days past due, combining two sources that otherwise live in
 * separate models: unpaid invoices (Phase 11's `dueDate`) and outstanding
 * `lend`/`borrow` transactions (Phase 9's `dueDate`). Both are bucketed by
 * the same rule, so a single ageing view covers "the household owes this
 * person" and "a customer hasn't paid this invoice" side by side.
 */
export async function getAgeingReport(
  scope: RequestScope,
  direction: 'receivable' | 'payable',
): Promise<{ asOf: string; direction: 'receivable' | 'payable'; rows: AgeingRow[]; totalsByBucket: Record<AgeingRow['bucket'], number>; totalMinor: number }> {
  const now = new Date();
  const rows: AgeingRow[] = [];

  if (direction === 'receivable') {
    const invoices = await Invoice.find({
      workspaceId: scope.workspaceId,
      deletedAt: null,
      status: 'sent',
    })
      .select('personId dueDate totalMinor number')
      .lean();

    const personIds = new Set(invoices.map((i) => String(i.personId)));
    const outstandingLoans = await Transaction.find({
      workspaceId: scope.workspaceId,
      deletedAt: null,
      type: 'lend',
      dueDate: { $ne: null },
      ...excludeHiddenTransactions(scope),
      $expr: { $lt: ['$settledMinor', '$amountMinor'] },
    })
      .select('personId dueDate amountMinor settledMinor')
      .lean();
    for (const loan of outstandingLoans) if (loan.personId) personIds.add(String(loan.personId));

    const people = personIds.size
      ? await Person.find({ _id: { $in: [...personIds] }, workspaceId: scope.workspaceId }).select('name').lean()
      : [];
    const nameById = new Map(people.map((p) => [String(p._id), p.name]));

    for (const invoice of invoices) {
      const daysPastDue = Math.floor((now.getTime() - invoice.dueDate.getTime()) / 86_400_000);
      rows.push({
        personId: String(invoice.personId),
        personName: nameById.get(String(invoice.personId)) ?? 'Unknown',
        source: 'invoice',
        referenceId: String(invoice._id),
        referenceLabel: invoice.number,
        dueDate: invoice.dueDate.toISOString(),
        daysPastDue,
        bucket: ageingBucket(daysPastDue),
        amountMinor: invoice.totalMinor,
      });
    }
    for (const loan of outstandingLoans) {
      if (!loan.personId || !loan.dueDate) continue;
      const daysPastDue = Math.floor((now.getTime() - loan.dueDate.getTime()) / 86_400_000);
      rows.push({
        personId: String(loan.personId),
        personName: nameById.get(String(loan.personId)) ?? 'Unknown',
        source: 'loan',
        referenceId: String(loan._id),
        referenceLabel: 'Loan',
        dueDate: loan.dueDate.toISOString(),
        daysPastDue,
        bucket: ageingBucket(daysPastDue),
        amountMinor: loan.amountMinor - loan.settledMinor,
      });
    }
  } else {
    const outstandingBorrows = await Transaction.find({
      workspaceId: scope.workspaceId,
      deletedAt: null,
      type: 'borrow',
      dueDate: { $ne: null },
      ...excludeHiddenTransactions(scope),
      $expr: { $lt: ['$settledMinor', '$amountMinor'] },
    })
      .select('personId dueDate amountMinor settledMinor')
      .lean();

    const personIds = new Set(outstandingBorrows.filter((b) => b.personId).map((b) => String(b.personId)));
    const people = personIds.size
      ? await Person.find({ _id: { $in: [...personIds] }, workspaceId: scope.workspaceId }).select('name').lean()
      : [];
    const nameById = new Map(people.map((p) => [String(p._id), p.name]));

    for (const loan of outstandingBorrows) {
      if (!loan.personId || !loan.dueDate) continue;
      const daysPastDue = Math.floor((now.getTime() - loan.dueDate.getTime()) / 86_400_000);
      rows.push({
        personId: String(loan.personId),
        personName: nameById.get(String(loan.personId)) ?? 'Unknown',
        source: 'loan',
        referenceId: String(loan._id),
        referenceLabel: 'Loan',
        dueDate: loan.dueDate.toISOString(),
        daysPastDue,
        bucket: ageingBucket(daysPastDue),
        amountMinor: loan.amountMinor - loan.settledMinor,
      });
    }
  }

  rows.sort((a, b) => b.daysPastDue - a.daysPastDue);

  const totalsByBucket: Record<AgeingRow['bucket'], number> = { not_due: 0, '0_30': 0, '31_60': 0, '61_90': 0, over_90: 0 };
  for (const row of rows) totalsByBucket[row.bucket] += row.amountMinor;

  return {
    asOf: now.toISOString(),
    direction,
    rows,
    totalsByBucket,
    totalMinor: rows.reduce((sum, r) => sum + r.amountMinor, 0),
  };
}

// ─────────────────────────────────────────────── GST summary (Phase 13)

export interface GstSummaryRow {
  taxPercent: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  invoiceCount: number;
}

/**
 * GST collected on issued invoices (`sent`, `overdue` or `paid` — anything
 * actually handed to a customer, never a `draft`), grouped by tax rate. No
 * filing or return claims are made anywhere in this app — this is a
 * summary to hand to an accountant, not a GSTR submission.
 */
export async function getGstSummary(
  scope: RequestScope,
  from: Date,
  to: Date,
): Promise<{ from: string; to: string; rows: GstSummaryRow[]; totalTaxableMinor: number; totalCgstMinor: number; totalSgstMinor: number; totalIgstMinor: number }> {
  const invoices = await Invoice.find({
    workspaceId: scope.workspaceId,
    deletedAt: null,
    status: { $ne: 'draft' },
    issueDate: { $gte: from, $lte: to },
  })
    .select('taxPercent subtotalMinor discountMinor gst')
    .lean();

  const byRate = new Map<number, GstSummaryRow>();
  for (const invoice of invoices) {
    const key = invoice.taxPercent;
    const row = byRate.get(key) ?? { taxPercent: key, taxableMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0, invoiceCount: 0 };
    row.taxableMinor += invoice.subtotalMinor - invoice.discountMinor;
    row.cgstMinor += invoice.gst?.cgstMinor ?? 0;
    row.sgstMinor += invoice.gst?.sgstMinor ?? 0;
    row.igstMinor += invoice.gst?.igstMinor ?? 0;
    row.invoiceCount += 1;
    byRate.set(key, row);
  }

  const rows = [...byRate.values()].sort((a, b) => a.taxPercent - b.taxPercent);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    rows,
    totalTaxableMinor: rows.reduce((sum, r) => sum + r.taxableMinor, 0),
    totalCgstMinor: rows.reduce((sum, r) => sum + r.cgstMinor, 0),
    totalSgstMinor: rows.reduce((sum, r) => sum + r.sgstMinor, 0),
    totalIgstMinor: rows.reduce((sum, r) => sum + r.igstMinor, 0),
  };
}

// ─────────────────────────────────────────────── Account summary report

export async function getAccountSummary(scope: RequestScope) {
  const totals = await getWorkspaceTotals(scope);
  const accounts = await Account.find({ workspaceId: scope.workspaceId, deletedAt: null, ...excludeHiddenAccounts(scope) })
    .select('name type cachedBalanceMinor isLiability isActive')
    .sort({ sortOrder: 1 })
    .lean();

  return {
    ...totals,
    accounts: accounts.map((a) => ({
      id: String(a._id),
      name: a.name,
      type: a.type,
      balanceMinor: a.cachedBalanceMinor,
      isLiability: a.isLiability,
      isActive: a.isActive,
    })),
  };
}
