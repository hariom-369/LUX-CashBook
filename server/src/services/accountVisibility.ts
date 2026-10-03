import { Types } from 'mongoose';
import { Account, Budget, GroupExpense, RecurringTransaction, SavingsGoal, Transaction } from '../models/index.js';
import type { RequestScope } from '../middleware/context.js';
import { notFound } from '../lib/errors.js';

/**
 * Private-account visibility (§Phase 9, decision 4): a `private` account —
 * and, where enforced, its transactions — is invisible to every workspace
 * member except the one who created it. `visibility` defaults to `shared`,
 * so every account that predates household workspaces is completely
 * unaffected.
 *
 * Enforced at account listing/access and the main transaction list + export
 * (`buildFilter`) — see `docs/ROADMAP_PHASE9_NOTES.md` for the explicit,
 * named list of aggregate views (dashboard totals, reports, cash book, budget
 * spend) this pass did not sweep, and why that's a bounded, documented gap
 * rather than an oversight.
 */
export async function getHiddenAccountIds(scope: Pick<RequestScope, 'userId' | 'workspaceId'>): Promise<Types.ObjectId[]> {
  const hidden = await Account.find({
    workspaceId: scope.workspaceId,
    visibility: 'private',
    userId: { $ne: scope.userId },
  })
    .select('_id')
    .lean();
  return hidden.map((a) => a._id);
}

/** Mongo filter fragment for `Account.find()` — excludes other members' private accounts. */
export function accountVisibilityFilter(scope: RequestScope): Record<string, unknown> {
  return { $or: [{ visibility: 'shared' }, { visibility: { $exists: false } }, { visibility: 'private', userId: scope.userId }] };
}

/**
 * Mongo `$match` fragment for `Transaction` queries: drops every transaction whose every leg is
 * on another member's private account (a transfer with one visible leg stays, masked). Spread it into a filter —
 * `{ workspaceId, deletedAt: null, ...excludeHiddenTransactions(scope) }` — and into the
 * `$match` stage of every aggregation that totals the ledger.
 */
export function excludeHiddenTransactions(scope: Pick<RequestScope, 'hiddenAccountIds'>): Record<string, unknown> {
  return scope.hiddenAccountIds.length > 0 ? { postings: { $elemMatch: { accountId: { $nin: scope.hiddenAccountIds } } } } : {};
}

/**
 * Can this viewer see anything of the transaction? One leg on a visible account is enough:
 * a transfer between a shared account and someone's private one is real activity on the shared
 * account (its balance moved), so it stays in that account's ledger — but only as a masked
 * entry (`maskForViewer`), never naming the private account or what the money was for.
 */
export function isVisibleTo(postings: Array<{ accountId: Types.ObjectId | string }>, hidden: Types.ObjectId[]): boolean {
  if (hidden.length === 0) return true;
  const hiddenSet = new Set(hidden.map(String));
  return postings.some((p) => !hiddenSet.has(String(p.accountId)));
}

/** True when any leg is on another member's private account (so the caller must not touch it). */
export function touchesHiddenAccount(postings: Array<{ accountId: Types.ObjectId | string }>, hidden: Types.ObjectId[]): boolean {
  if (hidden.length === 0) return false;
  const hiddenSet = new Set(hidden.map(String));
  return postings.some((p) => hiddenSet.has(String(p.accountId)));
}

/**
 * `_id` condition for an `Account` lookup by client-supplied id(s) that also refuses other members'
 * private accounts. Use this instead of spreading `excludeHiddenAccounts` next to an `_id`: both set
 * the same key, and the later one would silently replace the caller's id.
 */
export function visibleAccountIds(scope: Pick<RequestScope, 'hiddenAccountIds'>, ids: unknown | unknown[]): Record<string, unknown> {
  const list = Array.isArray(ids) ? ids : [ids];
  return scope.hiddenAccountIds.length > 0 ? { $in: list, $nin: scope.hiddenAccountIds } : { $in: list };
}

/** Mongo `_id` fragment for `Account` queries that must skip other members' private accounts (no `_id` of their own). */
export function excludeHiddenAccounts(scope: Pick<RequestScope, 'hiddenAccountIds'>): Record<string, unknown> {
  return scope.hiddenAccountIds.length > 0 ? { _id: { $nin: scope.hiddenAccountIds } } : {};
}

/**
 * How much of each person's cached balance comes from transactions this viewer may not see
 * (loans paid out of, or repaid into, another member's private account).
 *
 * A person is shared, so `Person.cachedBalanceMinor` includes those transactions. Showing it
 * to someone who cannot see the account would reveal that money moved and how much, so the
 * viewer's figure is `cachedBalanceMinor - hidden delta`. Empty (and free) when nothing is hidden.
 */
export async function getHiddenPersonDeltas(scope: Pick<RequestScope, 'workspaceId' | 'hiddenAccountIds'>): Promise<Map<string, number>> {
  if (scope.hiddenAccountIds.length === 0) return new Map();
  const rows = await Transaction.aggregate<{ _id: Types.ObjectId; total: number }>([
    {
      $match: {
        workspaceId: scope.workspaceId,
        deletedAt: null,
        personId: { $ne: null },
        'postings.accountId': { $in: scope.hiddenAccountIds },
      },
    },
    { $group: { _id: '$personId', total: { $sum: '$personDeltaMinor' } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.total]));
}

/**
 * Ids of the transactions touching another member's private account. For collections that
 * only point at a transaction (receipts, documents) and so cannot be matched on postings.
 * Empty - and free - when nothing is hidden.
 */
export async function getHiddenTransactionIds(scope: Pick<RequestScope, 'workspaceId' | 'hiddenAccountIds'>): Promise<Types.ObjectId[]> {
  if (scope.hiddenAccountIds.length === 0) return [];
  const rows = await Transaction.find({ workspaceId: scope.workspaceId, 'postings.accountId': { $in: scope.hiddenAccountIds } })
    .select('_id')
    .lean();
  return rows.map((r) => r._id);
}

/**
 * Ids (as strings, the form the audit trail stores) of every record that exists only because of
 * another member's private account: the accounts, their transactions, and any goal, budget,
 * recurring entry or group expense bound to one. The audit trail is workspace-wide, and its
 * summaries name accounts and amounts, so these entries must not be shown to anyone else.
 */
export async function getHiddenEntityIds(scope: Pick<RequestScope, 'workspaceId' | 'hiddenAccountIds'>): Promise<string[]> {
  const hidden = scope.hiddenAccountIds;
  if (hidden.length === 0) return [];
  const [transactions, goals, budgets, recurring, groupExpenses] = await Promise.all([
    getHiddenTransactionIds(scope),
    SavingsGoal.find({ workspaceId: scope.workspaceId, linkedAccountId: { $in: hidden } }).select('_id').lean(),
    Budget.find({ workspaceId: scope.workspaceId, accountId: { $in: hidden } }).select('_id').lean(),
    RecurringTransaction.find({ workspaceId: scope.workspaceId, $or: [{ accountId: { $in: hidden } }, { toAccountId: { $in: hidden } }] }).select('_id').lean(),
    GroupExpense.find({ workspaceId: scope.workspaceId, accountId: { $in: hidden } }).select('_id').lean(),
  ]);
  return [
    ...hidden,
    ...transactions,
    ...goals.map((g) => g._id),
    ...budgets.map((b) => b._id),
    ...recurring.map((r) => r._id),
    ...groupExpenses.map((g) => g._id),
  ].map(String);
}

/**
 * An account the caller may attach something to (a budget, goal, recurring entry...): it must be in
 * this workspace and not another member's private one. Answers exactly like a missing account, so a
 * guessed id cannot be used to find out whether it exists.
 */
export async function assertAccountUsable(scope: Pick<RequestScope, 'workspaceId' | 'hiddenAccountIds'>, accountId: string | Types.ObjectId): Promise<void> {
  if (!Types.ObjectId.isValid(String(accountId))) throw notFound('Account');
  const found = await Account.exists({ _id: visibleAccountIds(scope, accountId), workspaceId: scope.workspaceId, deletedAt: null });
  if (!found) throw notFound('Account');
}
