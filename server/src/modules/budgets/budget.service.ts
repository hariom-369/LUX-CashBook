import { Types, type HydratedDocument } from 'mongoose';
import {
  DEFAULT_BUDGET_THRESHOLDS,
  addMonths,
  endOfMonth,
  endOfWeek,
  safePercent,
  startOfMonth,
  startOfWeek,
  startOfYear,
  endOfYear,
  diffInDays,
  type BudgetDto,
  type BudgetProgressDto,
  type BudgetSuggestionDto,
} from '@khata/shared';
import { Account, Budget, Category, Transaction, type IBudget } from '../../models/index.js';
import { conflict, notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';
import { claimRevision } from '../../lib/revision.js';
import { assertAccountUsable, excludeHiddenTransactions } from '../../services/accountVisibility.js';

export type BudgetDoc = HydratedDocument<IBudget>;

export function toBudgetDto(budget: IBudget, categoryName?: string, accountName?: string): BudgetDto {
  return {
    id: String(budget._id),
    rev: budget.rev,
    workspaceId: String(budget.workspaceId),
    categoryId: budget.categoryId ? String(budget.categoryId) : null,
    categoryName,
    accountId: budget.accountId ? String(budget.accountId) : undefined,
    accountName,
    name: budget.name,
    amountMinor: budget.amountMinor,
    period: budget.period,
    startDate: budget.startDate.toISOString(),
    endDate: budget.endDate?.toISOString(),
    rollover: budget.rollover,
    alertThresholds: budget.alertThresholds,
    isActive: budget.isActive,
  };
}

/** The current period's [start, end] for a budget, anchored to `now`. */
function currentPeriod(budget: Pick<IBudget, 'period'>, now: Date): { from: Date; to: Date } {
  switch (budget.period) {
    case 'weekly':
      return { from: startOfWeek(now), to: endOfWeek(now) };
    case 'yearly':
      return { from: startOfYear(now), to: endOfYear(now) };
    case 'monthly':
    default:
      return { from: startOfMonth(now), to: endOfMonth(now) };
  }
}

function daysRemainingIn(period: { to: Date }, now: Date): number {
  return Math.max(0, diffInDays(period.to, now));
}

export interface CreateBudgetInput {
  name: string;
  categoryId: string | null;
  /** Optional (Phase 7) — scopes this budget to spending on one account only. */
  accountId?: string | null;
  amountMinor: number;
  period: 'monthly' | 'weekly' | 'yearly';
  startDate?: Date;
  rollover?: boolean;
  alertThresholds?: number[];
}

export async function createBudget(
  scope: RequestScope,
  input: CreateBudgetInput,
  audit: AuditContext,
): Promise<BudgetDoc> {
  if (input.accountId) await assertAccountUsable(scope, input.accountId);
  const budget = await Budget.create({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    name: input.name.trim(),
    categoryId: input.categoryId,
    accountId: input.accountId,
    amountMinor: input.amountMinor,
    period: input.period,
    startDate: input.startDate ?? new Date(),
    rollover: input.rollover ?? false,
    alertThresholds: input.alertThresholds?.length ? input.alertThresholds : [...DEFAULT_BUDGET_THRESHOLDS],
  }).catch((err) => {
    // The unique index on {workspaceId, categoryId, accountId, period} while
    // active is what stops two competing limits on the same category (and
    // account scope) from existing at once.
    if (err?.code === 11000) {
      throw conflict('An active budget already exists for that category, account and period.', 'BUDGET_EXISTS');
    }
    throw err;
  });

  await recordAudit(audit, {
    action: 'created',
    entityType: 'Budget',
    entityId: budget._id,
    summary: `Created budget "${budget.name}"`,
  });

  return budget;
}

export async function updateBudget(
  scope: RequestScope,
  budgetId: string,
  input: Partial<CreateBudgetInput> & { isActive?: boolean },
  audit: AuditContext,
  /** The `rev` the editor read; see lib/revision.ts. */
  expectedRev?: number,
): Promise<BudgetDoc> {
  if (!Types.ObjectId.isValid(budgetId)) throw notFound('Budget');
  const budget = await Budget.findOne({ _id: budgetId, workspaceId: scope.workspaceId });
  if (!budget || (budget.accountId && scope.hiddenAccountIds.some((h) => h.equals(budget.accountId!)))) throw notFound('Budget');
  if (input.accountId) await assertAccountUsable(scope, input.accountId);

  for (const key of ['name', 'amountMinor', 'period', 'rollover', 'alertThresholds', 'isActive', 'accountId'] as const) {
    if (input[key] !== undefined) (budget as unknown as Record<string, unknown>)[key] = input[key];
  }
  if (input.startDate) budget.startDate = input.startDate;

  await claimRevision(Budget, budget, expectedRev);
  await budget.save();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'Budget',
    entityId: budget._id,
    summary: `Updated budget "${budget.name}"`,
  });

  return budget;
}

export async function deleteBudget(scope: RequestScope, budgetId: string, audit: AuditContext): Promise<void> {
  if (!Types.ObjectId.isValid(budgetId)) throw notFound('Budget');
  const budget = await Budget.findOneAndDelete({ _id: budgetId, workspaceId: scope.workspaceId });
  if (!budget) throw notFound('Budget');

  await recordAudit(audit, {
    action: 'deleted',
    entityType: 'Budget',
    entityId: budget._id,
    summary: `Deleted budget "${budget.name}"`,
  });
}

/**
 * Compute live consumption for every active budget (§29).
 *
 * Spend is never stored — it is summed from live transactions inside the current
 * period on every call. A cached "spent" figure would go stale the instant a
 * historical transaction was edited, deleted or restored, and a budget that lies
 * about how close you are to the limit is worse than no budget at all.
 */
export async function listBudgetsWithProgress(
  scope: RequestScope,
  now: Date = new Date(),
): Promise<BudgetProgressDto[]> {
  // A budget scoped to another member's private account would reveal that account's spending.
  const budgets = await Budget.find({
    workspaceId: scope.workspaceId,
    isActive: true,
    ...(scope.hiddenAccountIds.length > 0 ? { accountId: { $nin: scope.hiddenAccountIds } } : {}),
  }).lean();
  if (budgets.length === 0) return [];

  const categoryIds = budgets.map((b) => b.categoryId).filter(Boolean) as Types.ObjectId[];
  const categories = categoryIds.length
    ? await Category.find({ _id: { $in: categoryIds } }).select('name').lean()
    : [];
  const categoryName = new Map(categories.map((c) => [String(c._id), c.name]));

  const accountIds = budgets.map((b) => b.accountId).filter(Boolean) as Types.ObjectId[];
  const accounts = accountIds.length
    ? await Account.find({ _id: { $in: accountIds } }).select('name').lean()
    : [];
  const accountName = new Map(accounts.map((a) => [String(a._id), a.name]));

  return Promise.all(
    budgets.map(async (budget) => {
      const period = currentPeriod(budget, now);

      const filter: Record<string, unknown> = {
        workspaceId: scope.workspaceId,
        deletedAt: null,
        type: 'expense',
        date: { $gte: period.from, $lte: period.to },
        ...excludeHiddenTransactions(scope),
      };
      if (budget.categoryId) {
        filter.$or = [{ categoryId: budget.categoryId }, { subcategoryId: budget.categoryId }];
      }
      if (budget.accountId) {
        filter['postings.accountId'] = budget.accountId;
      }

      const [result] = await Transaction.aggregate<{ total: number }>([
        { $match: filter },
        { $group: { _id: null, total: { $sum: '$amountMinor' } } },
      ]);

      let spentMinor = result?.total ?? 0;

      // Rollover carries yesterday's unspent budget forward as extra headroom —
      // spend against last period's remaining amount before this period's own.
      if (budget.rollover) {
        const previousPeriod = previousPeriodOf(budget, period);
        const [prevResult] = await Transaction.aggregate<{ total: number }>([
          {
            $match: {
              ...filter,
              date: { $gte: previousPeriod.from, $lte: previousPeriod.to },
            },
          },
          { $group: { _id: null, total: { $sum: '$amountMinor' } } },
        ]);
        const previousSpent = prevResult?.total ?? 0;
        const previousRemaining = Math.max(0, budget.amountMinor - previousSpent);
        // Effective spend is offset by whatever headroom carried in — expressed by
        // reducing this period's spend as if the limit were larger.
        spentMinor = Math.max(0, spentMinor - previousRemaining);
      }

      const percentUsed = safePercent(spentMinor, budget.amountMinor);
      const remainingMinor = budget.amountMinor - spentMinor;
      const daysRemaining = daysRemainingIn(period, now);

      const status: BudgetProgressDto['status'] =
        percentUsed >= 100 ? 'exceeded' : percentUsed >= 90 ? 'critical' : percentUsed >= 50 ? 'warning' : 'safe';

      // A simple linear projection from the rate so far — "if you keep spending
      // like this" — never a prediction the rest of the app treats as real.
      const totalDays = Math.max(1, diffInDays(period.to, period.from) + 1);
      const elapsedDays = Math.max(1, totalDays - daysRemaining);
      const projectedSpendMinor = Math.round(spentMinor * (totalDays / elapsedDays));

      return {
        ...toBudgetDto(
          budget,
          budget.categoryId ? categoryName.get(String(budget.categoryId)) : undefined,
          budget.accountId ? accountName.get(String(budget.accountId)) : undefined,
        ),
        spentMinor,
        remainingMinor,
        percentUsed,
        status,
        daysRemaining,
        safeDailyMinor: daysRemaining > 0 ? Math.max(0, Math.floor(remainingMinor / daysRemaining)) : 0,
        projectedSpendMinor,
      };
    }),
  );
}

function previousPeriodOf(budget: Pick<IBudget, 'period'>, current: { from: Date; to: Date }) {
  switch (budget.period) {
    case 'weekly':
      return { from: startOfWeek(new Date(current.from.getTime() - 1)), to: new Date(current.from.getTime() - 1) };
    case 'yearly':
      return { from: startOfYear(addMonths(current.from, -12)), to: new Date(current.from.getTime() - 1) };
    case 'monthly':
    default:
      return { from: startOfMonth(addMonths(current.from, -1)), to: new Date(current.from.getTime() - 1) };
  }
}

/**
 * "Copy last month" (§Phase 7, Budgets 2.0) — rather than cloning a period
 * document (budgets here are ongoing, not per-period), this suggests a
 * starting amount for any expense category that had real spending last
 * month but no active budget yet. Nothing is created until the user picks
 * one and calls the ordinary `POST /budgets`.
 */
export async function suggestBudgetsFromLastMonth(scope: RequestScope, now: Date = new Date()): Promise<BudgetSuggestionDto[]> {
  const lastMonthStart = startOfMonth(addMonths(now, -1));
  const lastMonthEnd = endOfMonth(addMonths(now, -1));

  const budgeted = await Budget.find({ workspaceId: scope.workspaceId, isActive: true, accountId: null })
    .select('categoryId')
    .lean();
  const alreadyBudgeted = new Set(budgeted.map((b) => String(b.categoryId)));

  const rows = await Transaction.aggregate<{ _id: Types.ObjectId | null; total: number }>([
    {
      $match: {
        workspaceId: scope.workspaceId,
        deletedAt: null,
        type: 'expense',
        date: { $gte: lastMonthStart, $lte: lastMonthEnd },
        ...excludeHiddenTransactions(scope),
      },
    },
    { $group: { _id: '$categoryId', total: { $sum: '$amountMinor' } } },
  ]);

  const candidates = rows.filter((r) => r._id && r.total > 0 && !alreadyBudgeted.has(String(r._id)));
  if (candidates.length === 0) return [];

  const categories = await Category.find({ _id: { $in: candidates.map((r) => r._id) } }).select('name').lean();
  const nameById = new Map(categories.map((c) => [String(c._id), c.name]));

  return candidates
    .map((r) => ({ categoryId: String(r._id), categoryName: nameById.get(String(r._id)) ?? 'Category', lastMonthSpentMinor: r.total }))
    .sort((a, b) => b.lastMonthSpentMinor - a.lastMonthSpentMinor);
}

/**
 * Check budgets against their alert thresholds and raise notifications for any
 * newly crossed one (§29). Idempotent per (budget, period, threshold) via a
 * deduping key, and called after every expense write rather than on a timer, so
 * the alert is never more than one request stale.
 */
export async function checkBudgetAlerts(scope: RequestScope, now: Date = new Date()): Promise<void> {
  const { isNotificationAllowed } = await import('../../services/notificationPolicy.js');
  if (!(await isNotificationAllowed(scope.userId, 'budgetAlerts'))) return;

  const progress = await listBudgetsWithProgress(scope, now);
  const { Notification } = await import('../../models/index.js');
  const { formatMoney } = await import('@khata/shared');

  for (const budget of progress) {
    const crossed = [...budget.alertThresholds]
      .sort((a, b) => b - a)
      .find((threshold) => budget.percentUsed >= threshold);
    if (!crossed) continue;

    const periodKey = `${budget.id}:${now.getFullYear()}-${now.getMonth() + 1}`;
    const dedupeKey = `budget:${periodKey}:${crossed}`;
    const title = crossed >= 100 ? `${budget.name} budget exceeded` : `${budget.name} budget at ${Math.round(crossed)}%`;
    const body = `You've spent ${formatMoney(budget.spentMinor, { currency: scope.currency, compactDecimals: true })} of ${formatMoney(budget.amountMinor, { currency: scope.currency, compactDecimals: true })}.`;

    const result = await Notification.updateOne(
      { userId: scope.userId, dedupeKey },
      {
        $setOnInsert: {
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          type: crossed >= 100 ? 'budget_exceeded' : 'budget_warning',
          title,
          body,
          icon: 'Target',
          link: '/budgets',
          amountMinor: budget.spentMinor,
          dedupeKey,
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount > 0) {
      const { deliverPushToUser } = await import('../../services/pushDelivery.service.js');
      await deliverPushToUser(scope.userId, { title, body, link: '/budgets' });
    }
  }
}
