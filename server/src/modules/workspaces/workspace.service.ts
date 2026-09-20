import { Types, type HydratedDocument } from 'mongoose';
import { DEFAULT_CATEGORIES, type WorkspaceDto, type WorkspaceMode } from '@khata/shared';
import { Account, Category, Workspace, type IWorkspace } from '../../models/index.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export type WorkspaceDoc = HydratedDocument<IWorkspace>;

export function toWorkspaceDto(w: IWorkspace): WorkspaceDto {
  return {
    id: String(w._id),
    name: w.name,
    mode: w.mode,
    currency: w.currency,
    isDefault: w.isDefault,
    isDemo: w.isDemo,
    fiscalYearStartMonth: w.fiscalYearStartMonth,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

export interface CreateWorkspaceInput {
  name: string;
  mode: WorkspaceMode;
  currency: string;
  isDefault?: boolean;
  isDemo?: boolean;
  fiscalYearStartMonth?: number;
  /** Create a starting Cash account so the user can record something immediately. */
  seedCashAccount?: boolean;
}

/**
 * Create a workspace and everything it needs to be usable straight away.
 *
 * A workspace with no categories and no accounts is a dead end — the user's first
 * action would be configuration rather than recording a transaction. So category
 * seeding and a Cash account happen here, as part of creation, rather than being
 * left to the UI to remember.
 */
export async function createWorkspace(
  userId: Types.ObjectId,
  input: CreateWorkspaceInput,
): Promise<WorkspaceDoc> {
  const name = input.name.trim();

  const existing = await Workspace.findOne({ userId, name }).lean();
  if (existing) {
    throw conflict('You already have a workspace with that name.', 'WORKSPACE_NAME_TAKEN');
  }

  const count = await Workspace.countDocuments({ userId });
  if (count >= 10) {
    throw conflict('You can have up to 10 workspaces.', 'WORKSPACE_LIMIT');
  }

  const workspace = await Workspace.create({
    userId,
    name,
    mode: input.mode,
    currency: input.currency,
    isDefault: input.isDefault ?? count === 0,
    isDemo: input.isDemo ?? false,
    fiscalYearStartMonth: input.fiscalYearStartMonth ?? (input.currency === 'INR' ? 4 : 1),
  });

  await seedCategories(userId, workspace._id, input.mode);

  if (input.seedCashAccount !== false) {
    await Account.create({
      userId,
      workspaceId: workspace._id,
      name: 'Cash',
      type: 'cash',
      currency: input.currency,
      openingBalanceMinor: 0,
      cachedBalanceMinor: 0,
      icon: 'Banknote',
      color: '#B08D4F',
      sortOrder: 0,
      // Matches the default `createAccount` applies to every other cash account
      // (account.service.ts) — a cash drawer cannot hold less than nothing, so this
      // is guarded the same way whether the account was seeded or created by hand.
      blockNegativeBalance: true,
    });
  }

  logger.info({ workspaceId: String(workspace._id), mode: input.mode }, 'Workspace created');
  return workspace;
}

/**
 * Seed the default category tree.
 *
 * Categories are per-workspace rather than global so that renaming "Food" in a
 * business workspace cannot disturb the personal one, and so a workspace export is
 * genuinely self-contained.
 */
export async function seedCategories(
  userId: Types.ObjectId,
  workspaceId: Types.ObjectId,
  mode: WorkspaceMode,
): Promise<void> {
  const applicable = DEFAULT_CATEGORIES.filter((c) => !c.mode || c.mode === mode);

  const parents = await Category.insertMany(
    applicable.map((c, index) => ({
      userId,
      workspaceId,
      name: c.name,
      kind: c.kind,
      icon: c.icon,
      color: c.color,
      parentId: null,
      isSystem: true,
      sortOrder: index,
    })),
    { ordered: true },
  );

  const children = applicable.flatMap((seed, index) => {
    const parent = parents[index];
    if (!parent || !seed.subcategories?.length) return [];
    return seed.subcategories.map((name, childIndex) => ({
      userId,
      workspaceId,
      name,
      kind: seed.kind,
      icon: seed.icon,
      color: seed.color,
      parentId: parent._id,
      isSystem: true,
      sortOrder: childIndex,
    }));
  });

  if (children.length) {
    await Category.insertMany(children, { ordered: true });
  }
}

export async function listWorkspaces(userId: Types.ObjectId): Promise<WorkspaceDoc[]> {
  return Workspace.find({ userId }).sort({ isDefault: -1, createdAt: 1 });
}

export async function getWorkspace(
  userId: Types.ObjectId,
  workspaceId: string | Types.ObjectId,
): Promise<WorkspaceDoc> {
  if (!Types.ObjectId.isValid(workspaceId)) throw notFound('Workspace');
  const workspace = await Workspace.findOne({ _id: workspaceId, userId });
  // Same response whether it does not exist or belongs to someone else — we never
  // confirm the existence of records the caller cannot see.
  if (!workspace) throw notFound('Workspace');
  return workspace;
}

export type WorkspacePatch = Partial<
  Pick<
    IWorkspace,
    'name' | 'currency' | 'fiscalYearStartMonth' | 'businessName' | 'businessAddress' | 'gstin' | 'logoUrl'
  >
>;

export async function updateWorkspace(
  userId: Types.ObjectId,
  workspaceId: string,
  patch: WorkspacePatch,
): Promise<WorkspaceDoc> {
  const workspace = await getWorkspace(userId, workspaceId);

  // Changing the currency of a workspace that already holds accounts would silently
  // reinterpret every stored amount. Refuse rather than corrupt.
  if (patch.currency && patch.currency !== workspace.currency) {
    const hasAccounts = await Account.exists({ workspaceId: workspace._id, deletedAt: null });
    if (hasAccounts) {
      throw conflict(
        'The currency cannot be changed once a workspace has accounts. Create a new workspace instead.',
        'CURRENCY_LOCKED',
      );
    }
  }

  Object.assign(workspace, patch);
  await workspace.save();
  return workspace;
}

export async function setDefaultWorkspace(userId: Types.ObjectId, workspaceId: string): Promise<void> {
  const workspace = await getWorkspace(userId, workspaceId);
  await Workspace.updateMany({ userId }, { $set: { isDefault: false } });
  await Workspace.updateOne({ _id: workspace._id }, { $set: { isDefault: true } });
}

/**
 * Deleting a workspace destroys financial history, so it is guarded: it cannot be
 * the last remaining workspace, and a non-demo workspace requires its name to be
 * typed back as confirmation.
 */
export async function deleteWorkspace(
  userId: Types.ObjectId,
  workspaceId: string,
  confirmation: string,
): Promise<void> {
  const workspace = await getWorkspace(userId, workspaceId);

  const total = await Workspace.countDocuments({ userId });
  if (total <= 1) {
    throw forbidden('You need at least one workspace.');
  }
  if (!workspace.isDemo && confirmation !== workspace.name) {
    throw forbidden('Type the workspace name exactly to confirm deletion.');
  }

  await purgeWorkspaceData(workspace._id);
  await workspace.deleteOne();

  if (workspace.isDefault) {
    const next = await Workspace.findOne({ userId }).sort({ createdAt: 1 });
    if (next) {
      next.isDefault = true;
      await next.save();
    }
  }
}

/**
 * Remove every record belonging to a workspace.
 *
 * Used by workspace deletion and by "reset demo data". Unlike transaction deletion
 * this is a genuine purge — the workspace itself is going away, so there is no
 * ledger left for the rows to belong to.
 */
export async function purgeWorkspaceData(workspaceId: Types.ObjectId): Promise<void> {
  const {
    Transaction, Person, Budget, SavingsGoal, RecurringTransaction,
    Reminder, Attachment, PettyCash, DayClosing, MonthClosing,
  } = await import('../../models/index.js');

  await Promise.all([
    Transaction.deleteMany({ workspaceId }),
    Account.deleteMany({ workspaceId }),
    Category.deleteMany({ workspaceId }),
    Person.deleteMany({ workspaceId }),
    Budget.deleteMany({ workspaceId }),
    SavingsGoal.deleteMany({ workspaceId }),
    RecurringTransaction.deleteMany({ workspaceId }),
    Reminder.deleteMany({ workspaceId }),
    Attachment.deleteMany({ workspaceId }),
    PettyCash.deleteMany({ workspaceId }),
    DayClosing.deleteMany({ workspaceId }),
    MonthClosing.deleteMany({ workspaceId }),
  ]);

  logger.warn({ workspaceId: String(workspaceId) }, 'Workspace data purged');
}
