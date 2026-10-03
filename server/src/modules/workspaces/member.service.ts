import { Types } from 'mongoose';
import type { WorkspaceMemberDto, WorkspaceRole } from '@khata/shared';
import { User, WorkspaceMember } from '../../models/index.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';

/**
 * Member management within a workspace (§Phase 9, decision 4). Ownership
 * itself is never transferred or changed here — a workspace always keeps
 * the owner it was created with in this pass; see
 * `docs/ROADMAP_PHASE9_NOTES.md` for why that's a deliberate boundary, not
 * an oversight.
 */
function assertCanManageMembers(role: WorkspaceRole): void {
  if (role !== 'owner' && role !== 'admin') {
    throw forbidden('Only an owner or admin can manage members.');
  }
}

export async function listMembers(scope: RequestScope): Promise<WorkspaceMemberDto[]> {
  const members = await WorkspaceMember.find({ workspaceId: scope.workspaceId }).sort({ joinedAt: 1 }).lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).select('name email').lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  return members.map((m) => {
    const user = userById.get(String(m.userId));
    return {
      id: String(m._id),
      userId: String(m.userId),
      name: user?.name ?? 'Unknown',
      email: user?.email ?? '',
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    };
  });
}

export async function changeMemberRole(
  scope: RequestScope,
  targetUserId: string,
  newRole: WorkspaceRole,
  audit: AuditContext,
): Promise<void> {
  assertCanManageMembers(scope.role);
  if (!Types.ObjectId.isValid(targetUserId)) throw notFound('Member');
  if (newRole === 'owner') {
    throw badRequest('Ownership cannot be reassigned here. The workspace keeps its original owner.');
  }

  const member = await WorkspaceMember.findOne({ workspaceId: scope.workspaceId, userId: targetUserId });
  if (!member) throw notFound('Member');
  if (member.role === 'owner') {
    throw forbidden("The owner's role cannot be changed.");
  }
  // Only the owner may promote someone to admin — an admin granting admin to
  // someone else would let admins mint peers without the owner's say.
  if (newRole === 'admin' && scope.role !== 'owner') {
    throw forbidden('Only the owner can promote a member to admin.');
  }

  member.role = newRole;
  await member.save();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'WorkspaceMember',
    entityId: member._id,
    summary: `Changed a member's role to ${newRole}`,
  });
}

export async function removeMember(
  scope: RequestScope,
  targetUserId: string,
  audit: AuditContext,
): Promise<void> {
  assertCanManageMembers(scope.role);
  if (!Types.ObjectId.isValid(targetUserId)) throw notFound('Member');
  if (targetUserId === String(scope.userId)) {
    throw badRequest('Use "Leave workspace" to remove yourself.');
  }

  const member = await WorkspaceMember.findOne({ workspaceId: scope.workspaceId, userId: targetUserId });
  if (!member) throw notFound('Member');
  if (member.role === 'owner') {
    throw forbidden('The owner cannot be removed.');
  }
  // An admin can remove ordinary members, but only the owner can remove another admin.
  if (member.role === 'admin' && scope.role !== 'owner') {
    throw forbidden('Only the owner can remove an admin.');
  }

  await member.deleteOne();

  await recordAudit(audit, {
    action: 'deleted',
    entityType: 'WorkspaceMember',
    entityId: member._id,
    summary: 'Removed a member from the workspace',
  });
}
