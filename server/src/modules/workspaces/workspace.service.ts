import { Types, type HydratedDocument } from 'mongoose';
import { DEFAULT_CATEGORIES, type WorkspaceDto, type WorkspaceMode, type WorkspaceRole } from '@khata/shared';
import { Account, Category, Workspace, WorkspaceMember, type IWorkspace } from '../../models/index.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { countMembers, listMemberships, resolveMembership } from '../../services/workspaceMembership.service.js';

export { countMembers };

export type WorkspaceDoc = HydratedDocument<IWorkspace>;

/** This user's own membership row for a workspace — carries `role` and `isDefault`. */
export async function getOwnMembership(userId: Types.ObjectId, workspaceId: Types.ObjectId) {
  return WorkspaceMember.findOne({ userId, workspaceId }).select('role isDefault').lean();
}

export function toWorkspaceDto(
  w: IWorkspace,
  myRole: WorkspaceRole,
  memberCount: number,
  isDefault: boolean,
): WorkspaceDto {
  return {
    id: String(w._id),
    name: w.name,
    mode: w.mode,
    currency: w.currency,
    isDefault,
    isDemo: w.isDemo,
    fiscalYearStartMonth: w.fiscalYearStartMonth,
    myRole,
    memberCount,
    businessName: w.businessName,
    businessAddress: w.businessAddress,
    gstin: w.gstin,
    logoUrl: w.logoUrl,
    state: w.state,
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

  // The creator is always the owner — membership is what `requireWorkspace`
  // actually checks (§Phase 9), so without this row the creator couldn't
  // reach the workspace they just made.
  await WorkspaceMember.create({
    workspaceId: workspace._id,
    userId,
    role: 'owner',
    isDefault: input.isDefault ?? count === 0,
    joinedAt: new Date(),
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

/** Every workspace this user can reach — owned or shared with them (§Phase 9) — not just ones they created. */
export async function listWorkspaces(userId: Types.ObjectId): Promise<WorkspaceDto[]> {
  const memberRows = await WorkspaceMember.find({ userId }).select('workspaceId role isDefault').lean();
  if (memberRows.length === 0) return [];

  const byWorkspace = new Map(memberRows.map((m) => [String(m.workspaceId), m]));
  const workspaces = await Workspace.find({ _id: { $in: memberRows.map((m) => m.workspaceId) } }).sort({ createdAt: 1 });

  const counts = await Promise.all(workspaces.map((w) => countMembers(w._id)));
  return workspaces
    .map((w, i) => {
      const membership = byWorkspace.get(String(w._id));
      return toWorkspaceDto(w, membership?.role ?? 'viewer', counts[i] ?? 1, membership?.isDefault ?? false);
    })
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

export async function getWorkspace(
  userId: Types.ObjectId,
  workspaceId: string | Types.ObjectId,
): Promise<{ doc: WorkspaceDoc; role: WorkspaceRole }> {
  if (!Types.ObjectId.isValid(workspaceId)) throw notFound('Workspace');
  const resolved = await resolveMembership(userId, new Types.ObjectId(workspaceId));
  // Same response whether it does not exist or belongs to someone else — we never
  // confirm the existence of records the caller cannot see.
  if (!resolved) throw notFound('Workspace');
  return { doc: resolved.workspace as WorkspaceDoc, role: resolved.role };
}

export type WorkspacePatch = Partial<
  Pick<
    IWorkspace,
    'name' | 'currency' | 'fiscalYearStartMonth' | 'businessName' | 'businessAddress' | 'gstin' | 'logoUrl' | 'state'
  >
>;

/** Owner/admin only — a member or viewer can use the workspace but not rename or reconfigure it. */
function assertCanManageWorkspace(role: WorkspaceRole): void {
  if (role !== 'owner' && role !== 'admin') {
    throw forbidden('Only an owner or admin can change workspace settings.');
  }
}

export async function updateWorkspace(
  userId: Types.ObjectId,
  workspaceId: string,
  patch: WorkspacePatch,
): Promise<WorkspaceDoc> {
  const { doc: workspace, role } = await getWorkspace(userId, workspaceId);
  assertCanManageWorkspace(role);

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

/**
 * Which workspace this user lands on at login — per-membership (see
 * `WorkspaceMember.isDefault`), so marking a shared workspace as "default"
 * only ever changes *this* user's landing page, never anyone else's.
 */
export async function setDefaultWorkspace(userId: Types.ObjectId, workspaceId: string): Promise<void> {
  const { doc: workspace } = await getWorkspace(userId, workspaceId);
  await WorkspaceMember.updateMany({ userId }, { $set: { isDefault: false } });
  await WorkspaceMember.updateOne({ userId, workspaceId: workspace._id }, { $set: { isDefault: true } });
}

/**
 * Leaving/deleting a workspace destroys financial history if you're the
 * owner, so it is guarded: a non-owner can always leave (they lose nothing
 * of their own), but deleting the underlying data requires being the owner,
 * it cannot be the last workspace this user can reach, and a non-demo
 * workspace requires its name to be typed back as confirmation.
 */
export async function deleteWorkspace(
  userId: Types.ObjectId,
  workspaceId: string,
  confirmation: string,
): Promise<void> {
  const { doc: workspace, role } = await getWorkspace(userId, workspaceId);
  if (role !== 'owner') {
    throw forbidden('Only the owner can delete this workspace. Use "Leave workspace" instead.');
  }

  const memberships = await listMemberships(userId);
  if (memberships.length <= 1) {
    throw forbidden('You need at least one workspace.');
  }
  if (!workspace.isDemo && confirmation !== workspace.name) {
    throw forbidden('Type the workspace name exactly to confirm deletion.');
  }

  const wasDefault = (await WorkspaceMember.findOne({ userId, workspaceId: workspace._id }).lean())?.isDefault ?? false;

  await purgeWorkspaceData(workspace._id);
  await workspace.deleteOne();
  await WorkspaceMember.deleteMany({ workspaceId: workspace._id });

  if (wasDefault) {
    const remaining = await listMemberships(userId);
    const next = remaining[0];
    if (next) {
      await WorkspaceMember.updateOne({ userId, workspaceId: next.workspaceId }, { $set: { isDefault: true } });
    }
  }
}

/** A non-owner member can leave a shared workspace at any time — their own membership row, nothing else. */
export async function leaveWorkspace(userId: Types.ObjectId, workspaceId: string): Promise<void> {
  const { role } = await getWorkspace(userId, workspaceId);
  if (role === 'owner') {
    throw forbidden('The owner cannot leave — delete the workspace or transfer ownership first.');
  }
  const memberships = await listMemberships(userId);
  if (memberships.length <= 1) {
    throw forbidden('You need at least one workspace.');
  }
  await WorkspaceMember.deleteOne({ userId, workspaceId: new Types.ObjectId(workspaceId) });
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

  // The attachment rows are about to go, so the files they point at must go too —
  // otherwise receipts would outlive the account on disk or in S3, unreferenced.
  // Best effort per file: one missing object must not block someone leaving.
  const { getStorageDriver } = await import('../../lib/storage.js');
  const storage = getStorageDriver();
  const files = await Attachment.find({ workspaceId }).select('storageKey thumbnailKey').lean();
  for (const file of files) {
    for (const key of [file.storageKey, file.thumbnailKey]) {
      if (!key) continue;
      await storage.delete(key).catch((err: unknown) =>
        logger.error({ err, key }, 'Could not delete a stored file while purging a workspace'),
      );
    }
  }

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
