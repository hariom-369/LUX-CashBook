import { Types } from 'mongoose';
import type { WorkspaceRole } from '@khata/shared';
import { Workspace, WorkspaceMember, type IWorkspace } from '../models/index.js';

/**
 * Shared membership resolution (§Phase 9, decision 4) — the single place
 * that answers "is this user allowed into this workspace, and as what role."
 * Used by `middleware/auth.ts#requireWorkspace` (the per-request gate) and by
 * `workspace.service.ts` (workspace listing/CRUD), so the two can never
 * disagree about who belongs where.
 */
export interface Membership {
  workspace: IWorkspace & { _id: Types.ObjectId };
  role: WorkspaceRole;
}

export async function resolveMembership(
  userId: Types.ObjectId,
  workspaceId: Types.ObjectId,
): Promise<Membership | null> {
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) return null;

  const membership = await WorkspaceMember.findOne({ workspaceId, userId }).lean();
  if (!membership) return null;

  return { workspace: workspace as IWorkspace & { _id: Types.ObjectId }, role: membership.role };
}

/** Every workspace a user belongs to, with their role in each — not just ones they own. */
export async function listMemberships(userId: Types.ObjectId): Promise<Array<{ workspaceId: Types.ObjectId; role: WorkspaceRole }>> {
  const rows = await WorkspaceMember.find({ userId }).select('workspaceId role').lean();
  return rows.map((r) => ({ workspaceId: r.workspaceId, role: r.role }));
}

export async function countMembers(workspaceId: Types.ObjectId): Promise<number> {
  return WorkspaceMember.countDocuments({ workspaceId });
}

export async function getRole(userId: Types.ObjectId, workspaceId: Types.ObjectId): Promise<WorkspaceRole | null> {
  const membership = await WorkspaceMember.findOne({ workspaceId, userId }).select('role').lean();
  return membership?.role ?? null;
}
