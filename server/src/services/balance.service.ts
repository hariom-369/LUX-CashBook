import { Types } from 'mongoose';
import { Account, Person, Transaction } from '../models/index.js';
import type { RequestScope } from '../middleware/context.js';
import type { UnitOfWork } from '../lib/transaction.js';
import { logger } from '../lib/logger.js';

/**
 * Balances (invariants I2 and I3).
 *
 * The rule this module exists to enforce:
 *
 *     balance = openingBalance + Σ (signed postings on live transactions)
 *
 * `Account.cachedBalanceMinor` is a *read cache*. It is kept current by the same
 * write that creates a transaction, and it can be rebuilt from the ledger at any
 * moment by `recomputeAccountBalance()`. Nothing in the system treats the cache as
 * authoritative when correctness matters: reconciliation, reports and the integrity
 * check all recompute from postings.
 *
 * This is the difference between "the balance is 12,500 because we stored 12,500"
 * and "the balance is 12,500 because these 43 rows add up to 12,500" — and §72
 * requires the second.
 */

export interface BalanceDelta {
  accountId: Types.ObjectId;
  amountMinor: number;
}

/**
 * Recompute one account's balance from its postings and write it back.
 *
 * Returns the authoritative figure. Used by the integrity checker, by restore, and
 * any time a cached value is suspected of drifting.
 */
export async function recomputeAccountBalance(
  workspaceId: Types.ObjectId,
  accountId: Types.ObjectId,
  uow?: UnitOfWork,
): Promise<number> {
  const account = await Account.findOne({ _id: accountId, workspaceId })
    .session(uow?.session ?? null)
    .lean();
  if (!account) return 0;

  const [result] = await Transaction.aggregate<{ total: number }>([
    { $match: { workspaceId, deletedAt: null, 'postings.accountId': accountId } },
    { $unwind: '$postings' },
    { $match: { 'postings.accountId': accountId } },
    { $group: { _id: null, total: { $sum: '$postings.amountMinor' } } },
  ]).session(uow?.session ?? null);

  const balance = account.openingBalanceMinor + (result?.total ?? 0);

  await Account.updateOne(
    { _id: accountId, workspaceId },
    { $set: { cachedBalanceMinor: balance, cachedBalanceAt: new Date() } },
    { session: uow?.session },
  );

  return balance;
}

/** Recompute every account in a workspace. Used by restore and by the audit tool. */
export async function recomputeAllBalances(workspaceId: Types.ObjectId): Promise<number> {
  const accounts = await Account.find({ workspaceId, deletedAt: null }).select('_id').lean();
  for (const account of accounts) {
    await recomputeAccountBalance(workspaceId, account._id);
  }
  return accounts.length;
}

/**
 * Apply signed deltas to the cached balances of several accounts.
 *
 * `$inc` rather than read-modify-write: two transactions saved at the same instant
 * against the same account must both land, and an increment is atomic at the
 * document level where a read-then-write is not.
 */
export async function applyBalanceDeltas(
  workspaceId: Types.ObjectId,
  deltas: BalanceDelta[],
  uow?: UnitOfWork,
): Promise<void> {
  if (deltas.length === 0) return;

  // Collapse repeated accounts so one transaction produces one update per account.
  const merged = new Map<string, number>();
  for (const delta of deltas) {
    const key = String(delta.accountId);
    merged.set(key, (merged.get(key) ?? 0) + delta.amountMinor);
  }

  await Promise.all(
    [...merged.entries()].map(([accountId, amountMinor]) =>
      Account.updateOne(
        { _id: new Types.ObjectId(accountId), workspaceId },
        { $inc: { cachedBalanceMinor: amountMinor }, $set: { cachedBalanceAt: new Date() } },
        { session: uow?.session },
      ),
    ),
  );
}

/**
 * Refuse a write that would push a protected account below zero.
 *
 * Only accounts with `blockNegativeBalance` are guarded, because a cash drawer
 * genuinely cannot go negative while a credit card is *supposed* to. The check runs
 * against the recomputed balance rather than the cache: a guard that trusts a
 * possibly-stale number is not a guard.
 */
export async function assertSufficientBalance(
  workspaceId: Types.ObjectId,
  deltas: BalanceDelta[],
  uow?: UnitOfWork,
): Promise<void> {
  const debits = deltas.filter((d) => d.amountMinor < 0);
  if (debits.length === 0) return;

  const accounts = await Account.find({
    _id: { $in: debits.map((d) => d.accountId) },
    workspaceId,
    blockNegativeBalance: true,
    deletedAt: null,
  })
    .session(uow?.session ?? null)
    .lean();

  if (accounts.length === 0) return;

  const { insufficientBalance } = await import('../lib/errors.js');
  const { formatMoney } = await import('@khata/shared');

  for (const account of accounts) {
    const delta = debits
      .filter((d) => String(d.accountId) === String(account._id))
      .reduce((sum, d) => sum + d.amountMinor, 0);

    const current = await recomputeAccountBalance(workspaceId, account._id, uow);
    if (current + delta < 0) {
      throw insufficientBalance(account.name, formatMoney(current, { currency: account.currency }));
    }
  }
}

/**
 * Total balance across a workspace's accounts.
 *
 * Computed from `cachedBalanceMinor` because this runs on every dashboard load and
 * aggregating the full posting history each time would not scale (§58). The cache
 * is maintained transactionally by every write path, and `verifyIntegrity()` exists
 * to prove it has not drifted.
 */
export async function getWorkspaceTotals(scope: RequestScope): Promise<{
  totalMinor: number;
  assetsMinor: number;
  liabilitiesMinor: number;
  byType: Record<string, number>;
}> {
  const accounts = await Account.find({
    workspaceId: scope.workspaceId,
    deletedAt: null,
    excludeFromTotals: false,
  })
    .select('type cachedBalanceMinor isLiability')
    .lean();

  let assets = 0;
  let liabilities = 0;
  const byType: Record<string, number> = {};

  for (const account of accounts) {
    const balance = account.cachedBalanceMinor;
    byType[account.type] = (byType[account.type] ?? 0) + balance;

    if (account.isLiability) {
      // A credit card carries a negative balance when money is owed; the liability
      // figure is the magnitude of that debt.
      liabilities += Math.abs(Math.min(balance, 0));
      assets += Math.max(balance, 0);
    } else {
      assets += balance;
    }
  }

  return { totalMinor: assets - liabilities, assetsMinor: assets, liabilitiesMinor: liabilities, byType };
}

/**
 * Recompute one person's ledger balance from their transactions.
 *
 *     balance = openingBalance + Σ personDeltaMinor
 *
 * Positive means they owe you (ARCHITECTURE §3.3).
 */
export async function recomputePersonBalance(
  workspaceId: Types.ObjectId,
  personId: Types.ObjectId,
  uow?: UnitOfWork,
): Promise<number> {
  const person = await Person.findOne({ _id: personId, workspaceId })
    .session(uow?.session ?? null)
    .lean();
  if (!person) return 0;

  const [result] = await Transaction.aggregate<{ total: number; last: Date }>([
    { $match: { workspaceId, personId, deletedAt: null } },
    { $group: { _id: null, total: { $sum: '$personDeltaMinor' }, last: { $max: '$date' } } },
  ]).session(uow?.session ?? null);

  const balance = person.openingBalanceMinor + (result?.total ?? 0);

  await Person.updateOne(
    { _id: personId, workspaceId },
    {
      $set: {
        cachedBalanceMinor: balance,
        cachedBalanceAt: new Date(),
        lastTransactionAt: result?.last ?? null,
      },
    },
    { session: uow?.session },
  );

  return balance;
}

export async function applyPersonDelta(
  workspaceId: Types.ObjectId,
  personId: Types.ObjectId,
  amountMinor: number,
  date: Date,
  uow?: UnitOfWork,
): Promise<void> {
  await Person.updateOne(
    { _id: personId, workspaceId },
    {
      $inc: { cachedBalanceMinor: amountMinor },
      $set: { cachedBalanceAt: new Date(), lastTransactionAt: date },
    },
    { session: uow?.session },
  );
}

export interface IntegrityIssue {
  kind: 'account_balance' | 'person_balance' | 'unbalanced_transfer' | 'orphan_posting';
  id: string;
  name: string;
  expectedMinor?: number;
  actualMinor?: number;
  detail?: string;
}

/**
 * Prove the ledger adds up (§51, §72).
 *
 * Every cached balance is recomputed from postings and compared; every transfer is
 * checked to sum to zero; every posting is checked to point at an account that
 * exists. Exposed through the API so a user can run it themselves, and used by the
 * test suite as the definition of "the books are correct".
 */
export async function verifyIntegrity(scope: RequestScope): Promise<{
  ok: boolean;
  checked: { accounts: number; people: number; transactions: number };
  issues: IntegrityIssue[];
}> {
  const issues: IntegrityIssue[] = [];
  const { workspaceId } = scope;

  const accounts = await Account.find({ workspaceId, deletedAt: null }).lean();
  const people = await Person.find({ workspaceId, deletedAt: null }).lean();

  // — Account balances must equal opening + Σ postings.
  const postingTotals = await Transaction.aggregate<{ _id: Types.ObjectId; total: number }>([
    { $match: { workspaceId, deletedAt: null } },
    { $unwind: '$postings' },
    { $group: { _id: '$postings.accountId', total: { $sum: '$postings.amountMinor' } } },
  ]);
  const postingByAccount = new Map(postingTotals.map((row) => [String(row._id), row.total]));

  for (const account of accounts) {
    const expected = account.openingBalanceMinor + (postingByAccount.get(String(account._id)) ?? 0);
    if (expected !== account.cachedBalanceMinor) {
      issues.push({
        kind: 'account_balance',
        id: String(account._id),
        name: account.name,
        expectedMinor: expected,
        actualMinor: account.cachedBalanceMinor,
      });
    }
  }

  // — Postings must not reference accounts that no longer exist.
  const knownAccounts = new Set(accounts.map((a) => String(a._id)));
  for (const [accountId] of postingByAccount) {
    if (!knownAccounts.has(accountId)) {
      issues.push({
        kind: 'orphan_posting',
        id: accountId,
        name: 'Unknown account',
        detail: 'Transactions post to an account that no longer exists.',
      });
    }
  }

  // — Person balances must equal opening + Σ person deltas.
  const personTotals = await Transaction.aggregate<{ _id: Types.ObjectId; total: number }>([
    { $match: { workspaceId, deletedAt: null, personId: { $ne: null } } },
    { $group: { _id: '$personId', total: { $sum: '$personDeltaMinor' } } },
  ]);
  const deltaByPerson = new Map(personTotals.map((row) => [String(row._id), row.total]));

  for (const person of people) {
    const expected = person.openingBalanceMinor + (deltaByPerson.get(String(person._id)) ?? 0);
    if (expected !== person.cachedBalanceMinor) {
      issues.push({
        kind: 'person_balance',
        id: String(person._id),
        name: person.name,
        expectedMinor: expected,
        actualMinor: person.cachedBalanceMinor,
      });
    }
  }

  // — Every transfer's legs must cancel exactly (invariant I4).
  const unbalanced = await Transaction.aggregate<{ _id: Types.ObjectId; sum: number; description: string }>([
    { $match: { workspaceId, deletedAt: null, type: 'transfer' } },
    {
      $project: {
        description: 1,
        sum: { $sum: '$postings.amountMinor' },
      },
    },
    { $match: { sum: { $ne: 0 } } },
    { $limit: 100 },
  ]);

  for (const row of unbalanced) {
    issues.push({
      kind: 'unbalanced_transfer',
      id: String(row._id),
      name: row.description || 'Transfer',
      actualMinor: row.sum,
      detail: 'The two legs of this transfer do not cancel out.',
    });
  }

  const transactionCount = await Transaction.countDocuments({ workspaceId, deletedAt: null });

  if (issues.length > 0) {
    logger.warn(
      { workspaceId: String(workspaceId), issueCount: issues.length },
      'Ledger integrity check found discrepancies',
    );
  }

  return {
    ok: issues.length === 0,
    checked: { accounts: accounts.length, people: people.length, transactions: transactionCount },
    issues,
  };
}

/** Repair drifted caches by recomputing them. History is never touched. */
export async function repairBalances(scope: RequestScope): Promise<{ accounts: number; people: number }> {
  const accounts = await Account.find({ workspaceId: scope.workspaceId, deletedAt: null }).select('_id').lean();
  const people = await Person.find({ workspaceId: scope.workspaceId, deletedAt: null }).select('_id').lean();

  for (const account of accounts) {
    await recomputeAccountBalance(scope.workspaceId, account._id);
  }
  for (const person of people) {
    await recomputePersonBalance(scope.workspaceId, person._id);
  }

  return { accounts: accounts.length, people: people.length };
}
