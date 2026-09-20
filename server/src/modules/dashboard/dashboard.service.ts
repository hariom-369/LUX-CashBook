import { Types } from 'mongoose';
import {
  TRANSACTION_META,
  addDays,
  addMonths,
  autoGranularity,
  endOfDay,
  endOfMonth,
  formatMoney,
  monthLabel,
  resolveRange,
  safePercent,
  startOfDay,
  startOfMonth,
  toDateKey,
  type CashFlowPointDto,
  type DashboardDto,
  type InsightDto,
  type RangePreset,
  type UpcomingItemDto,
} from '@khata/shared';
import { Account, Reminder, Transaction } from '../../models/index.js';
import type { RequestScope } from '../../middleware/context.js';
import { getWorkspaceTotals } from '../../services/balance.service.js';
import { getReceivablesAndPayables } from '../people/person.service.js';
import { toAccountDto } from '../accounts/account.service.js';
import { hydrate } from '../transactions/transaction.query.js';

const INCOME_TYPES = Object.entries(TRANSACTION_META)
  .filter(([, meta]) => meta.isIncome)
  .map(([type]) => type);

const EXPENSE_TYPES = Object.entries(TRANSACTION_META)
  .filter(([, meta]) => meta.isExpense)
  .map(([type]) => type);

/**
 * The dashboard (§7).
 *
 * Everything on this screen is derived from the ledger at read time. There is no
 * precomputed "dashboard document" that could drift from the transactions behind it
 * — a stale summary on the first screen a user sees is the fastest way to lose
 * their trust in the numbers everywhere else.
 *
 * Income and expense totals are built by *listing the types that count*, never by
 * excluding the ones that do not, so transfers and lending can never leak in
 * (invariants I5 and I6).
 */
export async function getDashboard(
  scope: RequestScope,
  options: { cashFlowRange?: RangePreset; now?: Date } = {},
): Promise<DashboardDto> {
  const now = options.now ?? new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const prevStart = startOfMonth(addMonths(now, -1));
  const prevEnd = endOfMonth(addMonths(now, -1));

  const [totals, accounts, thisMonth, lastMonth, cashFlow, recent, people, upcoming] =
    await Promise.all([
      getWorkspaceTotals(scope),
      Account.find({ workspaceId: scope.workspaceId, deletedAt: null, isActive: true })
        .sort({ sortOrder: 1 })
        .lean(),
      periodTotals(scope, monthStart, monthEnd),
      periodTotals(scope, prevStart, prevEnd),
      getCashFlow(scope, options.cashFlowRange ?? 'last_30_days', now),
      recentTransactions(scope, 8),
      getReceivablesAndPayables(scope),
      getUpcoming(scope, now),
    ]);

  const netSavings = thisMonth.incomeMinor - thisMonth.expenseMinor;

  return {
    totalBalanceMinor: totals.totalMinor,
    netWorthMinor: totals.assetsMinor - totals.liabilitiesMinor + people.receivableMinor - people.payableMinor,
    accounts: accounts.map((account) => {
      const dto = toAccountDto(account);
      return {
        id: dto.id,
        name: dto.name,
        type: dto.type,
        balanceMinor: dto.balanceMinor,
        color: dto.color,
        icon: dto.icon,
        isLiability: dto.isLiability,
      };
    }),
    month: {
      label: monthLabel(now.getFullYear(), now.getMonth(), true),
      incomeMinor: thisMonth.incomeMinor,
      expenseMinor: thisMonth.expenseMinor,
      netSavingsMinor: netSavings,
      // Savings rate is meaningless without income; 0 beats NaN or Infinity.
      savingsRate: safePercent(netSavings, thisMonth.incomeMinor),
      previousIncomeMinor: lastMonth.incomeMinor,
      previousExpenseMinor: lastMonth.expenseMinor,
    },
    cashFlow,
    recentTransactions: recent,
    receivables: {
      totalMinor: people.receivableMinor,
      people: people.receivables.slice(0, 5).map((person) => ({
        id: person.id,
        name: person.name,
        avatarUrl: person.avatarUrl,
        amountMinor: person.balanceMinor,
        isOverdue: false,
      })),
    },
    payables: {
      totalMinor: people.payableMinor,
      people: people.payables.slice(0, 5).map((person) => ({
        id: person.id,
        name: person.name,
        avatarUrl: person.avatarUrl,
        amountMinor: Math.abs(person.balanceMinor),
        isOverdue: false,
      })),
    },
    upcoming,
    budgets: [],
    goals: [],
    insights: buildInsights({
      currency: scope.currency,
      thisMonth,
      lastMonth,
      netSavings,
      receivableMinor: people.receivableMinor,
      receivableCount: people.receivables.length,
      payableMinor: people.payableMinor,
    }),
  };
}

interface PeriodTotals {
  incomeMinor: number;
  expenseMinor: number;
  topCategory?: { name: string; amountMinor: number };
  categoryTotals: Map<string, { name: string; amountMinor: number }>;
}

async function periodTotals(scope: RequestScope, from: Date, to: Date): Promise<PeriodTotals> {
  const rows = await Transaction.aggregate<{
    _id: { type: string; categoryId: Types.ObjectId | null };
    total: number;
  }>([
    {
      $match: {
        workspaceId: scope.workspaceId,
        deletedAt: null,
        date: { $gte: from, $lte: to },
        type: { $in: [...INCOME_TYPES, ...EXPENSE_TYPES] },
      },
    },
    { $group: { _id: { type: '$type', categoryId: '$categoryId' }, total: { $sum: '$amountMinor' } } },
  ]);

  let incomeMinor = 0;
  let expenseMinor = 0;
  const categoryIds = new Set<string>();

  for (const row of rows) {
    if (INCOME_TYPES.includes(row._id.type)) incomeMinor += row.total;
    else expenseMinor += row.total;
    if (row._id.categoryId) categoryIds.add(String(row._id.categoryId));
  }

  const { Category } = await import('../../models/index.js');
  const categories = categoryIds.size
    ? await Category.find({ _id: { $in: [...categoryIds] } }).select('name').lean()
    : [];
  const nameById = new Map(categories.map((c) => [String(c._id), c.name]));

  const categoryTotals = new Map<string, { name: string; amountMinor: number }>();
  for (const row of rows) {
    if (!EXPENSE_TYPES.includes(row._id.type) || !row._id.categoryId) continue;
    const key = String(row._id.categoryId);
    const existing = categoryTotals.get(key);
    categoryTotals.set(key, {
      name: nameById.get(key) ?? 'Uncategorised',
      amountMinor: (existing?.amountMinor ?? 0) + row.total,
    });
  }

  const topCategory = [...categoryTotals.values()].sort((a, b) => b.amountMinor - a.amountMinor)[0];

  return { incomeMinor, expenseMinor, topCategory, categoryTotals };
}

/**
 * Income vs expense over time (§7, §28).
 *
 * Buckets are chosen from the range length so a year never renders 365 bars, and
 * every bucket in the range is emitted even when empty — a chart with gaps where
 * quiet weeks were is harder to read than one with zeroes.
 */
export async function getCashFlow(
  scope: RequestScope,
  preset: RangePreset,
  now: Date = new Date(),
  custom?: { from: Date; to: Date },
): Promise<CashFlowPointDto[]> {
  const range = custom ?? resolveRange(preset, now);
  const granularity = autoGranularity(range);

  const format = { day: '%Y-%m-%d', week: '%Y-%V', month: '%Y-%m', quarter: '%Y-%m', year: '%Y' }[
    granularity
  ];

  const rows = await Transaction.aggregate<{ _id: { bucket: string; type: string }; total: number }>([
    {
      $match: {
        workspaceId: scope.workspaceId,
        deletedAt: null,
        date: { $gte: range.from, $lte: range.to },
        type: { $in: [...INCOME_TYPES, ...EXPENSE_TYPES] },
      },
    },
    {
      $group: {
        _id: {
          bucket: { $dateToString: { format, date: '$date' } },
          type: '$type',
        },
        total: { $sum: '$amountMinor' },
      },
    },
  ]);

  const byBucket = new Map<string, { incomeMinor: number; expenseMinor: number }>();
  for (const row of rows) {
    const entry = byBucket.get(row._id.bucket) ?? { incomeMinor: 0, expenseMinor: 0 };
    if (INCOME_TYPES.includes(row._id.type)) entry.incomeMinor += row.total;
    else entry.expenseMinor += row.total;
    byBucket.set(row._id.bucket, entry);
  }

  // Emit every bucket in the range, including empty ones.
  const points: CashFlowPointDto[] = [];
  const cursor = new Date(range.from);

  while (cursor <= range.to) {
    let key: string;
    let label: string;

    if (granularity === 'day') {
      key = toDateKey(cursor);
      label = `${cursor.getDate()} ${cursor.toLocaleString('en', { month: 'short' })}`;
      cursor.setDate(cursor.getDate() + 1);
    } else if (granularity === 'week') {
      key = `${cursor.getFullYear()}-${String(isoWeek(cursor)).padStart(2, '0')}`;
      label = `${cursor.getDate()} ${cursor.toLocaleString('en', { month: 'short' })}`;
      cursor.setDate(cursor.getDate() + 7);
    } else if (granularity === 'month') {
      key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      label = cursor.toLocaleString('en', { month: 'short' });
      cursor.setMonth(cursor.getMonth() + 1);
    } else {
      key = String(cursor.getFullYear());
      label = key;
      cursor.setFullYear(cursor.getFullYear() + 1);
    }

    const entry = byBucket.get(key) ?? { incomeMinor: 0, expenseMinor: 0 };
    points.push({
      bucket: key,
      label,
      incomeMinor: entry.incomeMinor,
      expenseMinor: entry.expenseMinor,
      netMinor: entry.incomeMinor - entry.expenseMinor,
    });

    // Guard against a pathological range producing an unbounded series.
    if (points.length > 400) break;
  }

  return points;
}

/** ISO-8601 week number, matching MongoDB's `%V`. */
function isoWeek(date: Date): number {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = target.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * 86_400_000));
}

async function recentTransactions(scope: RequestScope, limit: number) {
  const rows = await Transaction.find({ workspaceId: scope.workspaceId, deletedAt: null })
    .sort({ date: -1, _id: -1 })
    .limit(limit)
    .lean();
  return hydrate(scope, rows);
}

/**
 * What is coming up (§7).
 *
 * Loans past due, loans due soon, and dated reminders — merged into one list sorted
 * by urgency, because the user's question is "what needs attention", not "show me
 * three separate lists".
 */
export async function getUpcoming(scope: RequestScope, now: Date = new Date()): Promise<UpcomingItemDto[]> {
  const horizon = endOfDay(addDays(now, 30));
  const today = startOfDay(now);

  const [loans, reminders] = await Promise.all([
    Transaction.find({
      workspaceId: scope.workspaceId,
      deletedAt: null,
      type: { $in: ['lend', 'borrow'] },
      dueDate: { $ne: null, $lte: horizon },
      $expr: { $lt: ['$settledMinor', '$amountMinor'] },
    })
      .sort({ dueDate: 1 })
      .limit(20)
      .lean(),
    Reminder.find({
      workspaceId: scope.workspaceId,
      isDone: false,
      isDismissed: false,
      dueDate: { $lte: horizon },
    })
      .sort({ dueDate: 1 })
      .limit(20)
      .lean(),
  ]);

  const { Person } = await import('../../models/index.js');
  const personIds = loans.map((loan) => loan.personId).filter(Boolean) as Types.ObjectId[];
  const people = personIds.length
    ? await Person.find({ _id: { $in: personIds } }).select('name').lean()
    : [];
  const nameById = new Map(people.map((p) => [String(p._id), p.name]));

  const items: UpcomingItemDto[] = [];

  for (const loan of loans) {
    const outstanding = Math.max(0, loan.amountMinor - loan.settledMinor);
    const name = loan.personId ? (nameById.get(String(loan.personId)) ?? 'Someone') : 'Someone';
    const receivable = loan.type === 'lend';

    items.push({
      id: String(loan._id),
      kind: receivable ? 'receivable' : 'payable',
      title: receivable ? `${name} owes you` : `You owe ${name}`,
      subtitle: loan.description || undefined,
      amountMinor: outstanding,
      dueDate: loan.dueDate!.toISOString(),
      isOverdue: loan.dueDate! < today,
      icon: receivable ? 'HandCoins' : 'CreditCard',
      direction: receivable ? 'in' : 'out',
    });
  }

  for (const reminder of reminders) {
    items.push({
      id: String(reminder._id),
      kind: 'reminder',
      title: reminder.title,
      subtitle: reminder.notes,
      amountMinor: reminder.amountMinor ?? 0,
      dueDate: reminder.dueDate.toISOString(),
      isOverdue: reminder.dueDate < today,
      icon: 'Bell',
      direction: 'out',
    });
  }

  // Overdue first, then soonest.
  return items
    .sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      return a.dueDate.localeCompare(b.dueDate);
    })
    .slice(0, 10);
}

/**
 * Insights (§49).
 *
 * Strictly descriptive: what changed, where the money went, what is outstanding.
 * No recommendations and no projections — telling someone what to do with their
 * money on the basis of a month of categorised transactions would be overreach, and
 * §49 rules it out explicitly.
 */
function buildInsights(input: {
  currency: string;
  thisMonth: PeriodTotals;
  lastMonth: PeriodTotals;
  netSavings: number;
  receivableMinor: number;
  receivableCount: number;
  payableMinor: number;
}): InsightDto[] {
  const insights: InsightDto[] = [];
  const money = (value: number) => formatMoney(value, { currency: input.currency, compactDecimals: true });

  if (input.netSavings > 0) {
    insights.push({
      id: 'saved',
      text: `You saved ${money(input.netSavings)} this month.`,
      tone: 'positive',
      icon: 'PiggyBank',
    });
  } else if (input.netSavings < 0) {
    insights.push({
      id: 'overspent',
      text: `You spent ${money(-input.netSavings)} more than you earned this month.`,
      tone: 'negative',
      icon: 'TrendingDown',
    });
  }

  if (input.thisMonth.topCategory) {
    insights.push({
      id: 'top-category',
      text: `Your largest expense category is ${input.thisMonth.topCategory.name} at ${money(input.thisMonth.topCategory.amountMinor)}.`,
      tone: 'neutral',
      icon: 'ChartPie',
    });
  }

  // Compare the same category month over month, which is the comparison that
  // actually tells the user something.
  for (const [categoryId, current] of input.thisMonth.categoryTotals) {
    const previous = input.lastMonth.categoryTotals.get(categoryId);
    if (!previous || previous.amountMinor === 0) continue;
    const delta = current.amountMinor - previous.amountMinor;
    // Only surface a change that is both large in absolute terms and proportionally
    // meaningful, or every rounding wobble becomes an "insight".
    if (Math.abs(delta) < 50_000 || Math.abs(delta) / previous.amountMinor < 0.2) continue;

    insights.push({
      id: `category-${categoryId}`,
      text:
        delta > 0
          ? `You spent ${money(delta)} more on ${current.name} this month than last month.`
          : `You spent ${money(-delta)} less on ${current.name} this month than last month.`,
      tone: delta > 0 ? 'negative' : 'positive',
      icon: delta > 0 ? 'TrendingUp' : 'TrendingDown',
    });
    if (insights.length >= 5) break;
  }

  if (input.receivableMinor > 0) {
    insights.push({
      id: 'receivable',
      text: `${money(input.receivableMinor)} is currently outstanding from ${input.receivableCount} ${input.receivableCount === 1 ? 'person' : 'people'}.`,
      tone: 'neutral',
      icon: 'HandCoins',
    });
  }

  if (input.payableMinor > 0) {
    insights.push({
      id: 'payable',
      text: `You owe ${money(input.payableMinor)} in total.`,
      tone: 'neutral',
      icon: 'CreditCard',
    });
  }

  return insights.slice(0, 5);
}
