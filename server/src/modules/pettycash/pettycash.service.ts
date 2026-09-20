import { Types, type HydratedDocument } from 'mongoose';
import type { PettyCashDto } from '@khata/shared';
import { Account, PettyCash, type IPettyCash } from '../../models/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { createTransaction } from '../transactions/transaction.service.js';
import type { AuditContext } from '../../services/audit.service.js';
import { recordAudit } from '../../services/audit.service.js';

/**
 * Petty cash under the imprest system (§22).
 *
 * The float is a *policy* layered on top of an ordinary cash account, not a
 * separate ledger: spending and replenishment are regular transactions against
 * that account, so petty cash lives inside the same transaction engine as
 * everything else rather than a parallel system with its own rules to keep in
 * sync. This module only adds the imprest bookkeeping — the target float, the
 * custodian, and "how much needs to come back to top up to the float".
 */
export type PettyCashDoc = HydratedDocument<IPettyCash>;

export function toPettyCashDto(record: IPettyCash, accountName?: string, currentMinor = 0): PettyCashDto {
  const spentSinceReplenish = Math.max(0, record.imprestMinor - currentMinor);
  return {
    id: String(record._id),
    workspaceId: String(record.workspaceId),
    accountId: String(record.accountId),
    accountName,
    imprestMinor: record.imprestMinor,
    currentMinor,
    spentSinceReplenishMinor: spentSinceReplenish,
    replenishDueMinor: spentSinceReplenish,
    custodian: record.custodian,
    lastReplenishedAt: record.lastReplenishedAt?.toISOString(),
    isActive: record.isActive,
  };
}

export async function listPettyCash(scope: RequestScope): Promise<PettyCashDto[]> {
  const records = await PettyCash.find({ workspaceId: scope.workspaceId, isActive: true }).lean();
  if (records.length === 0) return [];

  const accounts = await Account.find({ _id: { $in: records.map((r) => r.accountId) } })
    .select('name cachedBalanceMinor')
    .lean();
  const accountById = new Map(accounts.map((a) => [String(a._id), a]));

  return records.map((record) => {
    const account = accountById.get(String(record.accountId));
    return toPettyCashDto(record, account?.name, account?.cachedBalanceMinor ?? 0);
  });
}

export interface CreatePettyCashInput {
  accountId: string;
  imprestMinor: number;
  custodian?: string;
  replenishFromAccountId?: string;
  lowBalanceThresholdMinor?: number;
}

export async function createPettyCash(
  scope: RequestScope,
  input: CreatePettyCashInput,
  audit: AuditContext,
): Promise<PettyCashDoc> {
  const account = await Account.findOne({ _id: input.accountId, workspaceId: scope.workspaceId, deletedAt: null });
  if (!account) throw notFound('Account');
  if (account.type !== 'cash') throw badRequest('Petty cash must be tracked on a cash account.');

  const existing = await PettyCash.findOne({ workspaceId: scope.workspaceId, accountId: account._id });
  if (existing) throw conflict('This account is already set up for petty cash.', 'PETTY_CASH_EXISTS');

  if (input.replenishFromAccountId) {
    const source = await Account.findOne({ _id: input.replenishFromAccountId, workspaceId: scope.workspaceId }).lean();
    if (!source) throw notFound('Account');
  }

  account.isPettyCash = true;
  await account.save();

  const record = await PettyCash.create({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    accountId: account._id,
    imprestMinor: input.imprestMinor,
    custodian: input.custodian,
    replenishFromAccountId: input.replenishFromAccountId,
    lowBalanceThresholdMinor: input.lowBalanceThresholdMinor ?? 0,
  });

  await recordAudit(audit, {
    action: 'created',
    entityType: 'PettyCash',
    entityId: record._id,
    summary: `Set up petty cash on "${account.name}" with a float of ${input.imprestMinor}`,
  });

  return record;
}

/**
 * Replenish the float back up to the imprest amount (§22).
 *
 * Posts a transfer from the funding account for exactly the amount spent since
 * the last top-up — never an arbitrary amount — so the float always returns to
 * precisely its target, which is the entire point of the imprest system.
 */
export async function replenishPettyCash(
  scope: RequestScope,
  pettyCashId: string,
  input: { fromAccountId?: string; date?: Date; note?: string },
  audit: AuditContext,
): Promise<{ pettyCash: PettyCashDto; replenishedMinor: number }> {
  if (!Types.ObjectId.isValid(pettyCashId)) throw notFound('Petty cash');
  const record = await PettyCash.findOne({ _id: pettyCashId, workspaceId: scope.workspaceId });
  if (!record) throw notFound('Petty cash');

  const account = await Account.findOne({ _id: record.accountId, workspaceId: scope.workspaceId });
  if (!account) throw notFound('Account');

  const fromAccountId = input.fromAccountId ?? record.replenishFromAccountId?.toString();
  if (!fromAccountId) throw badRequest('Choose which account funds the replenishment.');

  const spentSinceReplenish = Math.max(0, record.imprestMinor - account.cachedBalanceMinor);
  if (spentSinceReplenish <= 0) {
    throw badRequest('The float is already at its full imprest amount.');
  }

  await createTransaction(
    scope,
    {
      type: 'transfer',
      amountMinor: spentSinceReplenish,
      date: input.date ?? new Date(),
      accountId: fromAccountId,
      toAccountId: String(account._id),
      description: input.note || `Petty cash replenishment — ${account.name}`,
    },
    audit,
  );

  record.lastReplenishedAt = new Date();
  await record.save();

  const refreshed = await Account.findById(account._id).select('cachedBalanceMinor name').lean();

  return {
    pettyCash: toPettyCashDto(record, refreshed?.name, refreshed?.cachedBalanceMinor ?? 0),
    replenishedMinor: spentSinceReplenish,
  };
}

export async function deletePettyCash(scope: RequestScope, pettyCashId: string, audit: AuditContext): Promise<void> {
  if (!Types.ObjectId.isValid(pettyCashId)) throw notFound('Petty cash');
  const record = await PettyCash.findOneAndUpdate(
    { _id: pettyCashId, workspaceId: scope.workspaceId },
    { $set: { isActive: false } },
    { new: true },
  );
  if (!record) throw notFound('Petty cash');

  await Account.updateOne({ _id: record.accountId }, { $set: { isPettyCash: false } });

  await recordAudit(audit, {
    action: 'deleted',
    entityType: 'PettyCash',
    entityId: record._id,
    summary: 'Removed petty cash tracking',
  });
}
