import { Types, type HydratedDocument } from 'mongoose';
import {
  ACCOUNT_TYPE_META,
  addMonths,
  daysInMonth,
  diffInDays,
  type AccountDto,
  type AccountReconcilePreviewDto,
  type AccountReconcileResultDto,
  type AccountType,
  type AccountVisibility,
  type CardSummaryDto,
} from '@khata/shared';
import { Account, Transaction, type IAccount } from '../../models/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { recomputeAccountBalance } from '../../services/balance.service.js';
import { accountVisibilityFilter } from '../../services/accountVisibility.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';
import { claimRevision } from '../../lib/revision.js';

export type AccountDoc = HydratedDocument<IAccount>;

export function toAccountDto(account: IAccount): AccountDto {
  return {
    id: String(account._id),
    rev: account.rev,
    workspaceId: String(account.workspaceId),
    name: account.name,
    type: account.type,
    currency: account.currency,
    openingBalanceMinor: account.openingBalanceMinor,
    openingDate: account.openingDate.toISOString(),
    balanceMinor: account.cachedBalanceMinor,
    bankName: account.bankName,
    last4: account.last4,
    color: account.color,
    icon: account.icon,
    isActive: account.isActive,
    isLiability: account.isLiability,
    visibility: account.visibility,
    blockNegativeBalance: account.blockNegativeBalance,
    creditLimitMinor: account.creditLimitMinor,
    statementDay: account.statementDay,
    dueDay: account.dueDay,
    minimumDueMinor: account.minimumDueMinor,
    excludeFromTotals: account.excludeFromTotals,
    notes: account.notes,
    sortOrder: account.sortOrder,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  openingBalanceMinor?: number;
  openingDate?: Date;
  bankName?: string;
  last4?: string;
  color?: string;
  icon?: string;
  isLiability?: boolean;
  visibility?: AccountVisibility;
  blockNegativeBalance?: boolean;
  creditLimitMinor?: number;
  statementDay?: number;
  dueDay?: number;
  minimumDueMinor?: number;
  excludeFromTotals?: boolean;
  notes?: string;
  isPettyCash?: boolean;
}

export async function listAccounts(
  scope: RequestScope,
  options: { includeInactive?: boolean } = {},
): Promise<AccountDto[]> {
  const filter: Record<string, unknown> = {
    workspaceId: scope.workspaceId,
    deletedAt: null,
    ...accountVisibilityFilter(scope),
  };
  if (!options.includeInactive) filter.isActive = true;

  const accounts = await Account.find(filter).sort({ sortOrder: 1, createdAt: 1 }).lean();
  return accounts.map(toAccountDto);
}

export async function getAccount(scope: RequestScope, accountId: string): Promise<AccountDoc> {
  if (!Types.ObjectId.isValid(accountId)) throw notFound('Account');
  const account = await Account.findOne({
    _id: accountId,
    workspaceId: scope.workspaceId,
    deletedAt: null,
  });
  // Same response as "doesn't exist" — a private account's existence is not
  // confirmed to a member who isn't its owner (§Phase 9), mirroring how a
  // workspace that belongs to someone else is already treated.
  if (!account || (account.visibility === 'private' && String(account.userId) !== String(scope.userId))) {
    throw notFound('Account');
  }
  return account;
}

/**
 * Create an account.
 *
 * The opening balance is stored on the account rather than posted as a
 * transaction, because it is a *starting point*, not something that happened — and
 * `balance = opening + Σ postings` (invariant I2) already accounts for it. Posting
 * it as a fake transaction would put a row in the user's ledger that they never
 * recorded, and it would show up in their income for the month.
 */
export async function createAccount(
  scope: RequestScope,
  input: CreateAccountInput,
  audit: AuditContext,
): Promise<AccountDoc> {
  const count = await Account.countDocuments({ workspaceId: scope.workspaceId, deletedAt: null });
  if (count >= 100) throw conflict('You can have up to 100 accounts in one workspace.', 'ACCOUNT_LIMIT');

  const duplicate = await Account.findOne({
    workspaceId: scope.workspaceId,
    name: input.name.trim(),
    deletedAt: null,
  }).lean();
  if (duplicate) throw conflict('You already have an account with that name.', 'ACCOUNT_NAME_TAKEN');

  const typeMeta = ACCOUNT_TYPE_META[input.type];

  const account = await Account.create({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    name: input.name.trim(),
    type: input.type,
    currency: scope.currency,
    openingBalanceMinor: input.openingBalanceMinor ?? 0,
    openingDate: input.openingDate ?? new Date(),
    cachedBalanceMinor: input.openingBalanceMinor ?? 0,
    bankName: input.bankName,
    last4: input.last4,
    color: input.color ?? '#B08D4F',
    icon: input.icon ?? typeMeta.icon,
    isLiability: input.isLiability ?? typeMeta.liability,
    visibility: input.visibility ?? 'shared',
    // A cash drawer cannot hold less than nothing, so guard it by default; a card
    // is meant to go negative, so never guard that.
    blockNegativeBalance: input.blockNegativeBalance ?? input.type === 'cash',
    creditLimitMinor: input.creditLimitMinor,
    statementDay: input.statementDay,
    dueDay: input.dueDay,
    minimumDueMinor: input.minimumDueMinor,
    excludeFromTotals: input.excludeFromTotals ?? false,
    notes: input.notes,
    isPettyCash: input.isPettyCash ?? false,
    sortOrder: count,
  });

  await recordAudit(audit, {
    action: 'created',
    entityType: 'Account',
    entityId: account._id,
    summary: `Created ${typeMeta.label.toLowerCase()} account "${account.name}"`,
  });

  return account;
}

export type UpdateAccountInput = Partial<
  Pick<
    CreateAccountInput,
    | 'name' | 'bankName' | 'last4' | 'color' | 'icon' | 'blockNegativeBalance' | 'creditLimitMinor'
    | 'statementDay' | 'dueDay' | 'minimumDueMinor' | 'excludeFromTotals' | 'notes' | 'visibility'
  >
> & {
  isActive?: boolean;
  openingBalanceMinor?: number;
  sortOrder?: number;
};

export async function updateAccount(
  scope: RequestScope,
  accountId: string,
  input: UpdateAccountInput,
  audit: AuditContext,
  /** The `rev` the editor read; see lib/revision.ts. */
  expectedRev?: number,
): Promise<AccountDoc> {
  const account = await getAccount(scope, accountId);
  const before = { name: account.name, openingBalanceMinor: account.openingBalanceMinor };

  if (input.name && input.name.trim() !== account.name) {
    const duplicate = await Account.findOne({
      workspaceId: scope.workspaceId,
      name: input.name.trim(),
      deletedAt: null,
      _id: { $ne: account._id },
    }).lean();
    if (duplicate) throw conflict('You already have an account with that name.', 'ACCOUNT_NAME_TAKEN');
    account.name = input.name.trim();
  }

  const openingChanged =
    input.openingBalanceMinor !== undefined && input.openingBalanceMinor !== account.openingBalanceMinor;
  if (openingChanged) account.openingBalanceMinor = input.openingBalanceMinor!;

  for (const key of [
    'bankName', 'last4', 'color', 'icon', 'blockNegativeBalance',
    'creditLimitMinor', 'statementDay', 'dueDay', 'minimumDueMinor',
    'excludeFromTotals', 'notes', 'isActive', 'sortOrder', 'visibility',
  ] as const) {
    if (input[key] !== undefined) {
      (account as unknown as Record<string, unknown>)[key] = input[key];
    }
  }

  await claimRevision(Account, account, expectedRev);
  await account.save();

  // Changing the opening balance shifts every balance derived from it, so the
  // cached figure has to be rebuilt from the ledger rather than nudged.
  if (openingChanged) {
    account.cachedBalanceMinor = await recomputeAccountBalance(scope.workspaceId, account._id);
  }

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'Account',
    entityId: account._id,
    summary: `Updated account "${account.name}"`,
    before,
    after: { name: account.name, openingBalanceMinor: account.openingBalanceMinor },
  });

  return account;
}

/**
 * Archive or delete an account.
 *
 * An account with transactions is never removed — the transactions would lose the
 * thing they post to and every historical balance would become unexplainable. It is
 * deactivated instead, which hides it from pickers while keeping its ledger intact.
 * Only an account that has never been used can actually be deleted.
 */
export async function deleteAccount(
  scope: RequestScope,
  accountId: string,
  audit: AuditContext,
): Promise<{ deleted: boolean; deactivated: boolean; transactionCount: number }> {
  const account = await getAccount(scope, accountId);

  const remaining = await Account.countDocuments({
    workspaceId: scope.workspaceId,
    deletedAt: null,
    isActive: true,
    _id: { $ne: account._id },
  });
  if (remaining === 0) {
    throw badRequest('Keep at least one active account.');
  }

  const transactionCount = await Transaction.countDocuments({
    workspaceId: scope.workspaceId,
    'postings.accountId': account._id,
    deletedAt: null,
  });

  if (transactionCount > 0) {
    account.isActive = false;
    await account.save();

    await recordAudit(audit, {
      action: 'updated',
      entityType: 'Account',
      entityId: account._id,
      summary: `Deactivated account "${account.name}" (${transactionCount} transactions kept)`,
    });

    return { deleted: false, deactivated: true, transactionCount };
  }

  account.deletedAt = new Date();
  account.deletedBy = scope.userId;
  account.isActive = false;
  await account.save();

  await recordAudit(audit, {
    action: 'deleted',
    entityType: 'Account',
    entityId: account._id,
    summary: `Deleted unused account "${account.name}"`,
  });

  return { deleted: true, deactivated: false, transactionCount: 0 };
}

export interface AccountLedgerRow {
  id: string;
  date: string;
  description: string;
  type: string;
  referenceNo?: string;
  /** Signed effect on this account. */
  amountMinor: number;
  /** Balance after this row. */
  balanceMinor: number;
  categoryName?: string;
  personName?: string;
  counterAccountName?: string;
  isContra: boolean;
}

/**
 * One account's ledger with a running balance (§52).
 *
 * The running balance is computed forward from the opening balance rather than
 * backward from the current one. That way the numbers on screen are literally the
 * arithmetic the user would do by hand, and the last row necessarily equals the
 * balance shown everywhere else — if it ever did not, the integrity check would say
 * so rather than the user discovering it.
 */
export async function getAccountLedger(
  scope: RequestScope,
  accountId: string,
  options: { from?: Date; to?: Date; page?: number; limit?: number } = {},
): Promise<{
  account: AccountDto;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  rows: AccountLedgerRow[];
  total: number;
}> {
  const account = await getAccount(scope, accountId);
  const limit = Math.min(options.limit ?? 100, 500);
  const page = options.page ?? 1;

  // Everything before the window, collapsed into the opening figure.
  const priorMatch: Record<string, unknown> = {
    workspaceId: scope.workspaceId,
    deletedAt: null,
    'postings.accountId': account._id,
  };
  if (options.from) priorMatch.date = { $lt: options.from };

  const [prior] = options.from
    ? await Transaction.aggregate<{ total: number }>([
        { $match: priorMatch },
        { $unwind: '$postings' },
        { $match: { 'postings.accountId': account._id } },
        { $group: { _id: null, total: { $sum: '$postings.amountMinor' } } },
      ])
    : [{ total: 0 }];

  const openingBalanceMinor = account.openingBalanceMinor + (prior?.total ?? 0);

  const windowMatch: Record<string, unknown> = {
    workspaceId: scope.workspaceId,
    deletedAt: null,
    'postings.accountId': account._id,
  };
  if (options.from || options.to) {
    const range: Record<string, Date> = {};
    if (options.from) range.$gte = options.from;
    if (options.to) range.$lte = options.to;
    windowMatch.date = range;
  }

  const [rows, total] = await Promise.all([
    Transaction.find(windowMatch)
      .sort({ date: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(windowMatch),
  ]);

  const { hydrate } = await import('../transactions/transaction.query.js');
  const dtos = await hydrate(scope, rows);

  let running = openingBalanceMinor;
  const ledger: AccountLedgerRow[] = dtos.map((dto) => {
    const leg = dto.postings.find((p) => p.accountId === String(account._id));
    const amountMinor = leg?.amountMinor ?? 0;
    running += amountMinor;

    const counter = dto.postings.find((p) => p.accountId !== String(account._id));

    return {
      id: dto.id,
      date: dto.date,
      description: dto.description || dto.categoryName || dto.personName || 'Transaction',
      type: dto.type,
      referenceNo: dto.referenceNo,
      amountMinor,
      balanceMinor: running,
      categoryName: dto.categoryName,
      personName: dto.personName,
      counterAccountName: counter?.accountName,
      isContra: dto.type === 'transfer',
    };
  });

  return {
    account: toAccountDto(account),
    openingBalanceMinor,
    closingBalanceMinor: running,
    rows: ledger,
    total,
  };
}

/**
 * Account reconciliation (§Phase 5, D-3): compare Khata's own balance —
 * `cachedBalanceMinor`, the same figure shown everywhere else for this
 * account — against what the user read off a real bank statement.
 */
export async function previewReconciliation(
  scope: RequestScope,
  accountId: string,
  statementBalanceMinor: number,
): Promise<AccountReconcilePreviewDto> {
  const account = await getAccount(scope, accountId);
  return {
    ledgerBalanceMinor: account.cachedBalanceMinor,
    statementBalanceMinor,
    differenceMinor: statementBalanceMinor - account.cachedBalanceMinor,
  };
}

/**
 * Posts the difference as an `adjustment` transaction — never a silent
 * change to the cached balance — exactly the mechanism Daily Closing already
 * uses for the same kind of gap (`closing.service.ts`). A difference of zero
 * posts nothing; reconciling is still worth recording even when there's
 * nothing to adjust.
 */
export async function reconcileAccount(
  scope: RequestScope,
  accountId: string,
  statementBalanceMinor: number,
  note: string | undefined,
  audit: AuditContext,
): Promise<AccountReconcileResultDto> {
  const account = await getAccount(scope, accountId);
  const differenceMinor = statementBalanceMinor - account.cachedBalanceMinor;
  const reconciledAt = new Date();

  if (differenceMinor === 0) {
    return { differenceMinor: 0, reconciledAt: reconciledAt.toISOString() };
  }

  const { createTransaction } = await import('../transactions/transaction.service.js');
  const transaction = await createTransaction(
    scope,
    {
      type: 'adjustment',
      amountMinor: Math.abs(differenceMinor),
      date: reconciledAt,
      accountId,
      direction: differenceMinor > 0 ? 'in' : 'out',
      description: note?.trim() || `Reconciliation adjustment (${differenceMinor > 0 ? 'statement higher' : 'statement lower'})`,
    },
    audit,
  );

  return { differenceMinor, adjustmentTransactionId: String(transaction._id), reconciledAt: reconciledAt.toISOString() };
}

/**
 * Credit card centre (§Phase 7): utilisation and the next payment due date,
 * derived from the account's own balance and limit — never a second figure
 * that could disagree with what the ledger already says is owed.
 */
export async function getCardSummary(scope: RequestScope, accountId: string): Promise<CardSummaryDto> {
  const account = await getAccount(scope, accountId);
  const now = new Date();
  // A credit card's balance goes negative as it's spent on, same as any account
  // overdrawn — "owed" is just how far below zero it currently sits.
  const outstandingMinor = Math.max(0, -account.cachedBalanceMinor);
  const utilizationPercent = account.creditLimitMinor
    ? Math.round((outstandingMinor / account.creditLimitMinor) * 100)
    : undefined;

  let nextDueDate: Date | undefined;
  if (account.dueDay) {
    const clampedDay = Math.min(account.dueDay, daysInMonth(now.getFullYear(), now.getMonth()));
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), clampedDay, 12);
    nextDueDate = thisMonth >= now ? thisMonth : addMonths(thisMonth, 1);
  }

  return {
    outstandingMinor,
    creditLimitMinor: account.creditLimitMinor,
    utilizationPercent,
    statementDay: account.statementDay,
    dueDay: account.dueDay,
    minimumDueMinor: account.minimumDueMinor,
    nextDueDate: nextDueDate?.toISOString(),
    daysUntilDue: nextDueDate ? diffInDays(nextDueDate, now) : undefined,
  };
}
