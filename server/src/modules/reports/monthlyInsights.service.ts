import { Types } from 'mongoose';
import {
  EXPENSE_TYPES,
  INCOME_TYPES,
  TRANSACTION_META,
  addMonths,
  endOfDay,
  endOfMonth,
  startOfMonth,
  type MonthlyChangeDto,
  type MonthlyInsightsDto,
  type TransactionType,
} from '@khata/shared';
import { Category, Transaction } from '../../models/index.js';
import { badRequest } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { excludeHiddenTransactions } from '../../services/accountVisibility.js';
import { getUpcomingPayments } from '../upcoming/upcoming.service.js';

/**
 * Monthly financial insights (Insights page): one month's income, expenses, savings and
 * category spend, compared with the month before — all straight from recorded transactions.
 *
 * Accuracy rules:
 *  - Income and expense use the same transaction types as the dashboard (`INCOME_TYPES` /
 *    `EXPENSE_TYPES`), so the two can never disagree. Transfers and loans/repayments are never
 *    income or expense; their totals are reported separately so it's visible they were left out.
 *  - Refunds are income recorded under a "Refund" category: shown as their own line within income,
 *    never quietly netted against spending.
 *  - A month still in progress counts entries up to the end of today only, and is compared with
 *    the same number of days of the previous month — comparing ten days with thirty would invent a
 *    drop in spending that isn't there.
 *  - The only estimate is the month-end projection, labelled `isEstimate` and kept apart from facts.
 *  - Month boundaries are calendar months in the server's time zone, like the rest of the app.
 */

/** A change only counts as significant if it is both this large and at least 20%. */
const SIGNIFICANT_AMOUNT_MINOR = 50_000;
const SIGNIFICANT_FRACTION = 0.2;
const LOAN_TYPES = (Object.keys(TRANSACTION_META) as TransactionType[]).filter((t) => TRANSACTION_META[t].isPersonal);

interface Totals {
  incomeMinor: number;
  refundsMinor: number;
  expenseMinor: number;
  transfersMinor: number;
  loansMinor: number;
  count: number;
  byCategory: Map<string, number>; // expense by categoryId ('' = uncategorised)
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

async function totals(scope: RequestScope, from: Date, to: Date): Promise<Totals> {
  const rows = await Transaction.aggregate<{ _id: { type: TransactionType; categoryId: Types.ObjectId | null }; total: number; count: number }>([
    {
      $match: {
        workspaceId: scope.workspaceId,
        deletedAt: null,
        date: { $gte: from, $lte: to },
        ...excludeHiddenTransactions(scope),
      },
    },
    { $group: { _id: { type: '$type', categoryId: '$categoryId' }, total: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
  ]);

  const incomeCategoryIds = rows.filter((r) => INCOME_TYPES.includes(r._id.type) && r._id.categoryId).map((r) => r._id.categoryId!);
  const refundCategories = new Set(
    incomeCategoryIds.length
      ? (await Category.find({ _id: { $in: incomeCategoryIds }, name: { $regex: /^refunds?$/i } }).select('_id').lean()).map((c) => String(c._id))
      : [],
  );

  const result: Totals = { incomeMinor: 0, refundsMinor: 0, expenseMinor: 0, transfersMinor: 0, loansMinor: 0, count: 0, byCategory: new Map() };
  for (const row of rows) {
    const { type, categoryId } = row._id;
    if (INCOME_TYPES.includes(type)) {
      result.incomeMinor += row.total;
      result.count += row.count;
      if (categoryId && refundCategories.has(String(categoryId))) result.refundsMinor += row.total;
    } else if (EXPENSE_TYPES.includes(type)) {
      result.expenseMinor += row.total;
      result.count += row.count;
      const key = categoryId ? String(categoryId) : '';
      result.byCategory.set(key, (result.byCategory.get(key) ?? 0) + row.total);
    } else if (TRANSACTION_META[type]?.isTransfer) {
      result.transfersMinor += row.total;
    } else if (LOAN_TYPES.includes(type)) {
      result.loansMinor += row.total;
    }
  }
  return result;
}

function change(kind: MonthlyChangeDto['kind'], current: number, comparison: number, extra: Partial<MonthlyChangeDto> = {}): MonthlyChangeDto | null {
  const delta = current - comparison;
  if (Math.abs(delta) < SIGNIFICANT_AMOUNT_MINOR) return null;
  if (comparison > 0 && Math.abs(delta) / comparison < SIGNIFICANT_FRACTION) return null;
  return {
    kind,
    currentMinor: current,
    comparisonMinor: comparison,
    changeMinor: delta,
    changePercent: comparison > 0 ? Math.round((delta / comparison) * 1000) / 10 : null,
    ...extra,
  };
}

/** `month` is `YYYY-MM`; omitted means the current month. */
export async function getMonthlyInsights(scope: RequestScope, month: string | undefined, now: Date = new Date()): Promise<MonthlyInsightsDto> {
  const start = month ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1) : startOfMonth(now);
  const monthEnd = endOfMonth(start);
  if (start > now) throw badRequest('That month hasn’t started yet.');

  const isPartial = now <= monthEnd;
  const daysInMonth = monthEnd.getDate();
  const daysElapsed = isPartial ? now.getDate() : daysInMonth;
  const to = isPartial ? endOfDay(now) : monthEnd;

  const prevStart = startOfMonth(addMonths(start, -1));
  const prevEnd = endOfMonth(prevStart);
  const comparisonEnd = isPartial ? endOfDay(new Date(prevStart.getFullYear(), prevStart.getMonth(), Math.min(daysElapsed, prevEnd.getDate()))) : prevEnd;

  const [current, previous] = await Promise.all([totals(scope, start, to), totals(scope, prevStart, comparisonEnd)]);

  const categoryIds = [...new Set([...current.byCategory.keys(), ...previous.byCategory.keys()])].filter(Boolean);
  const names = new Map(
    categoryIds.length ? (await Category.find({ _id: { $in: categoryIds } }).select('name').lean()).map((c) => [String(c._id), c.name]) : [],
  );
  const nameOf = (key: string) => (key ? (names.get(key) ?? 'Uncategorised') : 'Uncategorised');

  const categories = [...new Set([...current.byCategory.keys(), ...previous.byCategory.keys()])]
    .map((key) => ({
      categoryId: key || null,
      name: nameOf(key),
      amountMinor: current.byCategory.get(key) ?? 0,
      sharePercent: current.expenseMinor > 0 ? Math.round(((current.byCategory.get(key) ?? 0) / current.expenseMinor) * 1000) / 10 : 0,
      comparisonMinor: previous.byCategory.get(key) ?? 0,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor || b.comparisonMinor - a.comparisonMinor || a.name.localeCompare(b.name));

  // No records at all in the comparison period (often the first month of use): there is nothing
  // to compare with, and "income rose by everything" would be a conclusion the data can't support.
  const significantChanges = (previous.count === 0 ? [] : [
    change('income', current.incomeMinor, previous.incomeMinor),
    change('expense', current.expenseMinor, previous.expenseMinor),
    ...categories.map((c) => change('category', c.amountMinor, c.comparisonMinor, { categoryId: c.categoryId, name: c.name })),
  ])
    .filter((c): c is MonthlyChangeDto => c !== null)
    .sort((a, b) => Math.abs(b.changeMinor) - Math.abs(a.changeMinor))
    .slice(0, 8);

  let upcoming: MonthlyInsightsDto['upcoming'] = null;
  if (isPartial) {
    const remainingDays = Math.max(1, daysInMonth - daysElapsed);
    const scheduled = await getUpcomingPayments(scope, { days: remainingDays, paidDays: 0 }, now);
    const due = scheduled.items.filter((i) => i.status !== 'paid' && new Date(i.dueDate) <= monthEnd);
    upcoming = {
      count: due.length,
      outMinor: due.filter((i) => i.direction === 'out' && i.amountMinor !== null).reduce((s, i) => s + i.amountMinor!, 0),
      inMinor: due.filter((i) => i.direction === 'in' && i.amountMinor !== null).reduce((s, i) => s + i.amountMinor!, 0),
      withoutAmountCount: due.filter((i) => i.amountMinor === null).length,
    };
  }

  const netSavings = current.incomeMinor - current.expenseMinor;
  return {
    month: monthKey(start),
    from: start.toISOString(),
    to: to.toISOString(),
    isPartial,
    daysElapsed,
    daysInMonth,
    hasData: current.count > 0,
    transactionCount: current.count,
    incomeMinor: current.incomeMinor,
    refundsMinor: current.refundsMinor,
    expenseMinor: current.expenseMinor,
    netSavingsMinor: netSavings,
    savingsRatePercent: current.incomeMinor > 0 ? Math.round((netSavings / current.incomeMinor) * 1000) / 10 : null,
    notCounted: { transfersMinor: current.transfersMinor, loansAndRepaymentsMinor: current.loansMinor },
    comparisonBasis: isPartial ? 'previous_month_to_date' : 'previous_month',
    comparison: {
      month: monthKey(prevStart),
      from: prevStart.toISOString(),
      to: comparisonEnd.toISOString(),
      incomeMinor: previous.incomeMinor,
      expenseMinor: previous.expenseMinor,
      netSavingsMinor: previous.incomeMinor - previous.expenseMinor,
      hasData: previous.count > 0,
    },
    categories,
    significantChanges,
    projection: isPartial && daysElapsed >= 7 && current.expenseMinor > 0 ? { expenseMinor: Math.round((current.expenseMinor * daysInMonth) / daysElapsed), isEstimate: true } : null,
    upcoming,
  };
}
