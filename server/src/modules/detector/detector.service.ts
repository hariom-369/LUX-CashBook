import { Types } from 'mongoose';
import { addDays, diffInDays, type RecurrenceFrequency, type SubscriptionSuggestionDto } from '@khata/shared';
import { Account, Category, DetectorDismissal, Payee, RecurringTransaction, Transaction } from '../../models/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import type { AuditContext } from '../../services/audit.service.js';
import { createRecurring } from '../recurring/recurring.service.js';
import { excludeHiddenTransactions } from '../../services/accountVisibility.js';

const LOOKBACK_DAYS = 180;
const MIN_OCCURRENCES = 3;
const AMOUNT_TOLERANCE = 0.12;

interface Candidate {
  key: string;
  payeeId?: string;
  accountId: string;
  categoryId?: string;
  description: string;
  dates: Date[];
  amounts: number[];
}

function normalizeDescription(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\d+/g, '#');
}

/** `values` is always non-empty at every call site (guarded by length checks above them). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (upper === undefined) throw new Error('median() called with an empty array');
  return sorted.length % 2 === 0 && lower !== undefined ? (lower + upper) / 2 : upper;
}

/**
 * Classify a sequence of gaps (in days) between consecutive occurrences as one
 * of the recurrence frequencies the rest of the app already understands, or
 * `null` if the gaps are too irregular to call a pattern.
 */
function classifyCadence(gaps: number[]): { frequency: RecurrenceFrequency; medianGap: number } | null {
  if (gaps.length === 0) return null;
  const medianGap = median(gaps);
  const maxDeviation = Math.max(...gaps.map((g) => Math.abs(g - medianGap)));

  // Monthly billing dates drift by a few days (28–31), everything else should
  // be tight — a genuine weekly/yearly bill doesn't wander by more than a couple
  // of days from one occurrence to the next.
  if (medianGap >= 6 && medianGap <= 8 && maxDeviation <= 3) return { frequency: 'weekly', medianGap };
  if (medianGap >= 27 && medianGap <= 32 && maxDeviation <= 5) return { frequency: 'monthly', medianGap };
  if (medianGap >= 350 && medianGap <= 380 && maxDeviation <= 10) return { frequency: 'yearly', medianGap };
  if (medianGap >= 9 && medianGap <= 349 && maxDeviation <= medianGap * 0.15) return { frequency: 'custom', medianGap };
  return null;
}

/**
 * Find repeating payee/description + amount + cadence patterns in a
 * workspace's recent expense history (§21, Phase 3 subscription detector).
 *
 * Deliberately conservative: it only looks at plain expenses that weren't
 * already posted by a recurring template (`recurringId: null`) — a pattern
 * already on autopilot has nothing to detect — and requires both a stable
 * amount and a stable interval before suggesting anything. It never creates or
 * changes a transaction; the strongest action it can take on its own is
 * nothing.
 */
export async function detectSubscriptions(scope: RequestScope, now: Date = new Date()): Promise<SubscriptionSuggestionDto[]> {
  const since = addDays(now, -LOOKBACK_DAYS);
  const transactions = await Transaction.find({
    workspaceId: scope.workspaceId,
    deletedAt: null,
    type: 'expense',
    recurringId: null,
    date: { $gte: since },
    ...excludeHiddenTransactions(scope),
  })
    .select('payeeId description postings categoryId amountMinor date')
    .sort({ date: 1 })
    .lean();

  const groups = new Map<string, Candidate>();
  for (const txn of transactions) {
    // An expense always has exactly one posting (invariant I4); skip the
    // theoretical case of a malformed row rather than crash the whole scan.
    const accountId = txn.postings[0]?.accountId;
    if (!accountId) continue;

    const key = txn.payeeId
      ? `payee:${txn.payeeId}:${accountId}`
      : `desc:${normalizeDescription(txn.description)}:${accountId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        payeeId: txn.payeeId ? String(txn.payeeId) : undefined,
        accountId: String(accountId),
        categoryId: txn.categoryId ? String(txn.categoryId) : undefined,
        description: txn.description,
        dates: [],
        amounts: [],
      };
      groups.set(key, group);
    }
    group.dates.push(txn.date);
    group.amounts.push(txn.amountMinor);
  }

  const candidates = [...groups.values()].filter((g) => g.dates.length >= MIN_OCCURRENCES);
  if (candidates.length === 0) return [];

  const dismissals = await DetectorDismissal.find({ workspaceId: scope.workspaceId }).select('signature').lean();
  const dismissed = new Set(dismissals.map((d) => d.signature));

  const activeRecurring = await RecurringTransaction.find({ workspaceId: scope.workspaceId, isActive: true })
    .select('payeeId accountId')
    .lean();
  const hasActiveBillFor = new Set(
    activeRecurring.filter((r) => r.payeeId).map((r) => `payee:${r.payeeId}:${r.accountId}`),
  );

  const accountIds = new Set(candidates.map((c) => c.accountId));
  const categoryIds = new Set(candidates.map((c) => c.categoryId).filter(Boolean) as string[]);
  const payeeIds = new Set(candidates.map((c) => c.payeeId).filter(Boolean) as string[]);
  const [accounts, categories, payees] = await Promise.all([
    Account.find({ _id: { $in: [...accountIds] } }).select('name').lean(),
    categoryIds.size ? Category.find({ _id: { $in: [...categoryIds] } }).select('name').lean() : [],
    payeeIds.size ? Payee.find({ _id: { $in: [...payeeIds] } }).select('name').lean() : [],
  ]);
  const accountName = new Map(accounts.map((a) => [String(a._id), a.name]));
  const categoryName = new Map(categories.map((c) => [String(c._id), c.name]));
  const payeeName = new Map(payees.map((p) => [String(p._id), p.name]));

  const suggestions: SubscriptionSuggestionDto[] = [];

  for (const group of candidates) {
    if (group.key.startsWith('payee:') && hasActiveBillFor.has(group.key)) continue;

    const medianAmount = median(group.amounts);
    const amountStable = group.amounts.every((a) => Math.abs(a - medianAmount) <= medianAmount * AMOUNT_TOLERANCE);
    if (!amountStable) continue;

    // `candidates` was filtered to `dates.length >= MIN_OCCURRENCES`, so every
    // index below is in bounds — the `!` assertions just tell the compiler that.
    const gaps = group.dates.slice(1).map((d, i) => diffInDays(d, group.dates[i]!));
    const cadence = classifyCadence(gaps);
    if (!cadence) continue;

    const signature = `${group.key}:${cadence.frequency}`;
    if (dismissed.has(signature)) continue;

    const lastDate = group.dates[group.dates.length - 1]!;
    suggestions.push({
      signature,
      payeeId: group.payeeId,
      payeeName: group.payeeId ? payeeName.get(group.payeeId) : undefined,
      description: group.description,
      amountMinor: Math.round(medianAmount),
      accountId: group.accountId,
      accountName: accountName.get(group.accountId),
      categoryId: group.categoryId,
      categoryName: group.categoryId ? categoryName.get(group.categoryId) : undefined,
      frequency: cadence.frequency,
      occurrenceCount: group.dates.length,
      lastDate: lastDate.toISOString(),
      nextExpectedDate: addDays(lastDate, cadence.medianGap).toISOString(),
    });
  }

  return suggestions.sort((a, b) => a.nextExpectedDate.localeCompare(b.nextExpectedDate));
}

export async function dismissSuggestion(scope: RequestScope, signature: string): Promise<void> {
  await DetectorDismissal.updateOne(
    { workspaceId: scope.workspaceId, signature },
    { $set: { userId: scope.userId, workspaceId: scope.workspaceId, signature } },
    { upsert: true },
  );
}

/**
 * Turn a suggestion into a real bill (§21). Always created paused-for-confirm
 * (`autoPost: false`) regardless of the caller's usual default — a detected
 * pattern deserves one manual confirmation before the system starts posting it
 * on its own, even though the user has already reviewed the suggestion once.
 */
export async function createBillFromSuggestion(
  scope: RequestScope,
  suggestion: {
    signature: string;
    description: string;
    amountMinor: number;
    accountId: string;
    categoryId?: string;
    payeeId?: string;
    frequency: RecurrenceFrequency;
    nextExpectedDate: string;
  },
  audit: AuditContext,
): Promise<ReturnType<typeof createRecurring>> {
  if (!Types.ObjectId.isValid(suggestion.accountId)) throw notFound('Account');
  if (suggestion.amountMinor <= 0) throw badRequest('The detected amount must be positive.');

  const recurring = await createRecurring(
    scope,
    {
      name: suggestion.description.slice(0, 60) || 'Subscription',
      type: 'expense',
      amountMinor: suggestion.amountMinor,
      accountId: suggestion.accountId,
      categoryId: suggestion.categoryId ?? null,
      payeeId: suggestion.payeeId ?? null,
      description: suggestion.description,
      frequency: suggestion.frequency,
      intervalDays: suggestion.frequency === 'custom' ? 30 : undefined,
      startDate: new Date(suggestion.nextExpectedDate),
      autoPost: false,
      billKind: 'subscription',
    },
    audit,
  );

  await dismissSuggestion(scope, suggestion.signature);
  return recurring;
}
