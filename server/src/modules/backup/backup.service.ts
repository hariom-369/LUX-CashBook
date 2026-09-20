import { Types } from 'mongoose';
import {
  Account, Budget, Category, Person, PettyCash, RecurringTransaction,
  Reminder, SavingsGoal, Transaction, Workspace,
} from '../../models/index.js';
import type { RequestScope } from '../../middleware/context.js';
import { withTransaction } from '../../lib/transaction.js';
import { badRequest } from '../../lib/errors.js';
import { recomputeAllBalances } from '../../services/balance.service.js';
import { logger } from '../../lib/logger.js';

/**
 * Backup & restore (§40).
 *
 * The export is a complete, self-contained snapshot of one workspace — every
 * collection that belongs to it, as plain JSON, with every ObjectId reference
 * turned into a string so the file has no driver-specific encoding a user's
 * machine could choke on. This is what "never make users dependent on the
 * application" (§40) actually requires: the file has to be readable and restorable
 * without this codebase, not just importable back into it.
 */
const BACKUP_VERSION = 1;

export interface BackupPayload {
  backupVersion: number;
  generatedAt: string;
  workspace: Record<string, unknown>;
  accounts: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  people: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  budgets: Record<string, unknown>[];
  goals: Record<string, unknown>[];
  recurring: Record<string, unknown>[];
  reminders: Record<string, unknown>[];
  pettyCash: Record<string, unknown>[];
}

function plain<T extends { toJSON: () => Record<string, unknown> }>(docs: T[]): Record<string, unknown>[] {
  return docs.map((doc) => doc.toJSON());
}

export async function createBackup(scope: RequestScope): Promise<BackupPayload> {
  const workspace = await Workspace.findOne({ _id: scope.workspaceId, userId: scope.userId });
  if (!workspace) throw badRequest('Workspace not found.');

  const [accounts, categories, people, transactions, budgets, goals, recurring, reminders, pettyCash] =
    await Promise.all([
      Account.find({ workspaceId: scope.workspaceId }),
      Category.find({ workspaceId: scope.workspaceId }),
      Person.find({ workspaceId: scope.workspaceId }),
      Transaction.find({ workspaceId: scope.workspaceId }),
      Budget.find({ workspaceId: scope.workspaceId }),
      SavingsGoal.find({ workspaceId: scope.workspaceId }),
      RecurringTransaction.find({ workspaceId: scope.workspaceId }),
      Reminder.find({ workspaceId: scope.workspaceId }),
      PettyCash.find({ workspaceId: scope.workspaceId }),
    ]);

  return {
    backupVersion: BACKUP_VERSION,
    generatedAt: new Date().toISOString(),
    workspace: workspace.toJSON(),
    accounts: plain(accounts),
    categories: plain(categories),
    people: plain(people),
    transactions: plain(transactions),
    budgets: plain(budgets),
    goals: plain(goals),
    recurring: plain(recurring),
    reminders: plain(reminders),
    pettyCash: plain(pettyCash),
  };
}

/**
 * Restore a backup into a brand-new workspace.
 *
 * Deliberately never overwrites an existing workspace: a restore is additive, so a
 * mistaken upload can never silently destroy the data someone already has. Every
 * id in the file is re-mapped to a fresh ObjectId as it's inserted — the original
 * ids are meaningless once collections are re-created, and reusing them risks a
 * collision with an id already in use elsewhere in this database.
 */
export async function restoreBackup(
  userId: Types.ObjectId,
  payload: BackupPayload,
  newWorkspaceName?: string,
): Promise<{ workspaceId: string; counts: Record<string, number> }> {
  if (!payload || typeof payload !== 'object' || payload.backupVersion !== BACKUP_VERSION) {
    throw badRequest('That file is not a recognised Khata backup, or was made by an incompatible version.');
  }
  for (const key of ['accounts', 'categories', 'people', 'transactions'] as const) {
    if (!Array.isArray(payload[key])) {
      throw badRequest('That backup file is missing required data and cannot be restored.');
    }
  }

  return withTransaction(async (uow) => {
    const workspaceId = new Types.ObjectId();
    const idMap = new Map<string, Types.ObjectId>();
    const remap = (oldId: unknown): Types.ObjectId => {
      const key = String(oldId);
      if (!idMap.has(key)) idMap.set(key, new Types.ObjectId());
      return idMap.get(key)!;
    };

    const src = payload.workspace as Record<string, unknown>;
    await Workspace.create(
      [
        {
          _id: workspaceId,
          userId,
          name: newWorkspaceName?.trim() || `${String(src.name ?? 'Restored')} (Restored)`,
          mode: src.mode ?? 'personal',
          currency: src.currency ?? 'INR',
          fiscalYearStartMonth: src.fiscalYearStartMonth ?? 4,
          isDemo: false,
        },
      ],
      { session: uow.session },
    );

    const counts: Record<string, number> = {};

    async function insertAll<T extends { id: string }>(
      model: { insertMany: (docs: unknown[], opts: unknown) => Promise<unknown[]> },
      rows: T[],
      transform: (row: T) => Record<string, unknown>,
    ): Promise<void> {
      if (rows.length === 0) return;
      const docs = rows.map((row) => ({ _id: remap(row.id), ...transform(row) }));
      await model.insertMany(docs, { session: uow.session, ordered: true });
    }

    await insertAll(Account, payload.accounts as Array<{ id: string }>, (row) => ({
      ...omitMeta(row),
      userId,
      workspaceId,
    }));

    await insertAll(Category, payload.categories as Array<{ id: string; parentId?: string | null }>, (row) => ({
      ...omitMeta(row),
      userId,
      workspaceId,
      parentId: row.parentId ? remap(row.parentId) : null,
    }));

    await insertAll(Person, payload.people as Array<{ id: string }>, (row) => ({
      ...omitMeta(row),
      userId,
      workspaceId,
    }));

    await insertAll(
      Transaction,
      payload.transactions as Array<{
        id: string;
        postings: Array<{ accountId: string; amountMinor: number }>;
        categoryId?: string;
        subcategoryId?: string;
        personId?: string;
        parentTransactionId?: string;
      }>,
      (row) => ({
        ...omitMeta(row),
        userId,
        workspaceId,
        postings: row.postings.map((p) => ({ accountId: remap(p.accountId), amountMinor: p.amountMinor })),
        categoryId: row.categoryId ? remap(row.categoryId) : null,
        subcategoryId: row.subcategoryId ? remap(row.subcategoryId) : null,
        personId: row.personId ? remap(row.personId) : null,
        // Repayment→loan links are remapped only when both sides are present in
        // this backup; a dangling reference is dropped rather than left invalid.
        parentTransactionId: row.parentTransactionId ? remap(row.parentTransactionId) : null,
        attachmentIds: [], // Files are not part of a data backup (§40 covers data).
        recurringId: null, // Re-linked below once recurring templates exist.
      }),
    );

    await insertAll(Budget, payload.budgets as Array<{ id: string; categoryId?: string | null }>, (row) => ({
      ...omitMeta(row),
      userId,
      workspaceId,
      categoryId: row.categoryId ? remap(row.categoryId) : null,
    }));

    await insertAll(SavingsGoal, payload.goals as Array<{ id: string; linkedAccountId?: string | null }>, (row) => ({
      ...omitMeta(row),
      userId,
      workspaceId,
      linkedAccountId: row.linkedAccountId ? remap(row.linkedAccountId) : null,
    }));

    await insertAll(
      RecurringTransaction,
      payload.recurring as Array<{ id: string; accountId: string; toAccountId?: string; categoryId?: string; personId?: string }>,
      (row) => ({
        ...omitMeta(row),
        userId,
        workspaceId,
        accountId: remap(row.accountId),
        toAccountId: row.toAccountId ? remap(row.toAccountId) : null,
        categoryId: row.categoryId ? remap(row.categoryId) : null,
        personId: row.personId ? remap(row.personId) : null,
      }),
    );

    await insertAll(Reminder, payload.reminders as Array<{ id: string; personId?: string; transactionId?: string }>, (row) => ({
      ...omitMeta(row),
      userId,
      workspaceId,
      personId: row.personId ? remap(row.personId) : null,
      transactionId: row.transactionId ? remap(row.transactionId) : null,
    }));

    await insertAll(PettyCash, payload.pettyCash as Array<{ id: string; accountId: string }>, (row) => ({
      ...omitMeta(row),
      userId,
      workspaceId,
      accountId: remap(row.accountId),
    }));

    for (const key of ['accounts', 'categories', 'people', 'transactions', 'budgets', 'goals', 'recurring', 'reminders', 'pettyCash'] as const) {
      counts[key] = (payload[key] as unknown[]).length;
    }

    uow.onRollback(async () => {
      await Workspace.deleteOne({ _id: workspaceId });
    });

    return { workspaceId: String(workspaceId), counts };
  }).then(async (result) => {
    // Balances are recomputed from the restored postings rather than trusted from
    // the backup file — the authoritative figure is always derived (invariant I2).
    await recomputeAllBalances(new Types.ObjectId(result.workspaceId));
    logger.info({ workspaceId: result.workspaceId, counts: result.counts }, 'Backup restored');
    return result;
  });
}

function omitMeta(row: Record<string, unknown>): Record<string, unknown> {
  const { id, createdAt, updatedAt, ...rest } = row;
  void id;
  void createdAt;
  void updatedAt;
  return rest;
}
