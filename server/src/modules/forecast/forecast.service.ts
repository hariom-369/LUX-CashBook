import { addDays, toDateKey, type CashFlowForecastDto } from '@khata/shared';
import { RecurringTransaction } from '../../models/index.js';
import { getWorkspaceTotals } from '../../services/balance.service.js';
import { computeNextRun } from '../recurring/recurring.service.js';
import type { RequestScope } from '../../middleware/context.js';

/**
 * Cash-flow forecast (§Phase 7) — a 7/30/90-day projection built only from
 * what's already known and scheduled: every active recurring income/expense
 * item, walked forward occurrence by occurrence with the exact same
 * `computeNextRun` the scheduler itself uses, so the projected dates can
 * never disagree with when things would actually post. Transfers are
 * skipped — they move money between the user's own accounts, net zero
 * against the one starting total this projects forward from
 * (`getWorkspaceTotals`, the same figure the dashboard already shows).
 *
 * Always returned with `isEstimate: true` and never written anywhere a real
 * balance is read from — a forecast that could be mistaken for an actual
 * figure would be worse than no forecast at all.
 */
export async function getForecast(scope: RequestScope, days: number, now: Date = new Date()): Promise<CashFlowForecastDto> {
  const { totalMinor } = await getWorkspaceTotals(scope);
  const end = addDays(now, days);

  const recurring = await RecurringTransaction.find({
    workspaceId: scope.workspaceId,
    isActive: true,
    isPaused: false,
    ...(scope.hiddenAccountIds.length > 0 ? { accountId: { $nin: scope.hiddenAccountIds } } : {}),
    type: { $in: ['income', 'expense'] },
    nextRunDate: { $lte: end },
  })
    .select('type amountMinor nextRunDate frequency intervalDays dayOfWeek dayOfMonth monthOfYear')
    .lean();

  const deltaByDay = new Map<string, number>();
  const MAX_OCCURRENCES_PER_ITEM = 500; // guards against a misconfigured daily/custom schedule looping forever

  for (const item of recurring) {
    let occurrence = item.nextRunDate;
    let guard = 0;
    while (occurrence <= end && guard < MAX_OCCURRENCES_PER_ITEM) {
      if (occurrence >= now) {
        const key = toDateKey(occurrence);
        const signed = item.type === 'income' ? item.amountMinor : -item.amountMinor;
        deltaByDay.set(key, (deltaByDay.get(key) ?? 0) + signed);
      }
      occurrence = computeNextRun(item, occurrence);
      guard++;
    }
  }

  const points: CashFlowForecastDto['points'] = [];
  let running = totalMinor;
  for (let d = 0; d <= days; d++) {
    const key = toDateKey(addDays(now, d));
    running += deltaByDay.get(key) ?? 0;
    points.push({ date: key, projectedBalanceMinor: running });
  }

  return { asOf: now.toISOString(), startingBalanceMinor: totalMinor, days, points, isEstimate: true };
}
