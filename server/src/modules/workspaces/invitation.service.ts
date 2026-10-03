import { Types } from 'mongoose';
import type { InvitationDto, WorkspaceRole } from '@khata/shared';
import { Invitation, User, Workspace, WorkspaceMember } from '../../models/index.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { generateActionToken, hashToken } from '../../lib/tokens.js';
import { sendMail, workspaceInvitationEmail } from '../../lib/mailer.js';
import { env } from '../../config/env.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';

/**
 * Invitations by email (§Phase 9, decision 4). Scoped to this app's own
 * accounts: the invited address must already have a Khata account, which
 * keeps this pass to "add someone who's already here" rather than also
 * building a parallel invite-to-signup flow. See
 * `docs/ROADMAP_PHASE9_NOTES.md` for that boundary.
 */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function toInvitationDto(invitation: { _id: Types.ObjectId; email: string; role: WorkspaceRole; expiresAt: Date; createdAt: Date }, invitedByName?: string): InvitationDto {
  return {
    id: String(invitation._id),
    email: invitation.email,
    role: invitation.role,
    invitedByName,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  };
}

function assertCanInvite(role: WorkspaceRole): void {
  if (role !== 'owner' && role !== 'admin') {
    throw forbidden('Only an owner or admin can invite members.');
  }
}

export async function createInvitation(
  scope: RequestScope,
  input: { email: string; role: WorkspaceRole },
  audit: AuditContext,
): Promise<InvitationDto> {
  assertCanInvite(scope.role);
  if (input.role === 'owner') throw badRequest('An invitation cannot grant ownership.');
  // Mirrors member.service.ts#changeMemberRole: only the owner may mint a new
  // admin, whether by promotion or by invitation directly as one — otherwise
  // an admin could grow their own peer group without the owner's say.
  if (input.role === 'admin' && scope.role !== 'owner') {
    throw forbidden('Only the owner can invite someone directly as admin.');
  }

  const email = input.email.trim().toLowerCase();
  const invitedUser = await User.findOne({ email }).select('_id name').lean();
  if (!invitedUser) {
    throw badRequest('No Khata account uses that email address yet. They need to sign up first.');
  }

  const alreadyMember = await WorkspaceMember.findOne({ workspaceId: scope.workspaceId, userId: invitedUser._id }).lean();
  if (alreadyMember) throw badRequest('That person is already a member of this workspace.');

  const memberCount = await WorkspaceMember.countDocuments({ workspaceId: scope.workspaceId });
  if (memberCount >= 20) throw badRequest('A workspace can have up to 20 members.');

  await Invitation.deleteMany({ workspaceId: scope.workspaceId, email, acceptedAt: null });

  // `generateActionToken`'s own `expiresAt` (1 hour, for email verification and
  // password reset) is too short for an invitation — this sets its own, longer one.
  const { token, hash } = generateActionToken();
  const invitation = await Invitation.create({
    workspaceId: scope.workspaceId,
    email,
    role: input.role,
    invitedBy: scope.userId,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });

  const workspace = await Workspace.findById(scope.workspaceId).select('name').lean();
  const inviter = await User.findById(scope.userId).select('name').lean();

  await sendMail({
    to: email,
    ...workspaceInvitationEmail(workspace?.name ?? 'a workspace', input.role, `${env.APP_URL}/settings/workspaces?inviteToken=${token}`),
  });

  await recordAudit(audit, {
    action: 'created',
    entityType: 'Invitation',
    entityId: invitation._id,
    summary: `Invited ${email} as ${input.role}`,
  });

  return toInvitationDto(invitation, inviter?.name);
}

export async function listInvitations(scope: RequestScope): Promise<InvitationDto[]> {
  assertCanInvite(scope.role);
  const invitations = await Invitation.find({ workspaceId: scope.workspaceId, acceptedAt: null }).sort({ createdAt: -1 }).lean();
  const inviters = await User.find({ _id: { $in: invitations.map((i) => i.invitedBy) } }).select('name').lean();
  const nameById = new Map(inviters.map((u) => [String(u._id), u.name]));
  return invitations.map((i) => toInvitationDto(i, nameById.get(String(i.invitedBy))));
}

export async function revokeInvitation(scope: RequestScope, invitationId: string, audit: AuditContext): Promise<void> {
  assertCanInvite(scope.role);
  if (!Types.ObjectId.isValid(invitationId)) throw notFound('Invitation');
  const invitation = await Invitation.findOneAndDelete({ _id: invitationId, workspaceId: scope.workspaceId, acceptedAt: null });
  if (!invitation) throw notFound('Invitation');

  await recordAudit(audit, {
    action: 'deleted',
    entityType: 'Invitation',
    entityId: invitation._id,
    summary: `Revoked the invitation sent to ${invitation.email}`,
  });
}

/** Shown before accepting — a token proves nothing until `acceptInvitation` is actually called. */
export async function previewInvitation(token: string): Promise<{ workspaceName: string; role: WorkspaceRole; email: string }> {
  const invitation = await Invitation.findOne({ tokenHash: hashToken(token), acceptedAt: null, expiresAt: { $gt: new Date() } }).lean();
  if (!invitation) throw notFound('Invitation');

  const workspace = await Workspace.findById(invitation.workspaceId).select('name').lean();
  return { workspaceName: workspace?.name ?? 'Workspace', role: invitation.role, email: invitation.email };
}

export async function acceptInvitation(userId: Types.ObjectId, userEmail: string, token: string, audit: AuditContext): Promise<Types.ObjectId> {
  const invitation = await Invitation.findOne({ tokenHash: hashToken(token), acceptedAt: null, expiresAt: { $gt: new Date() } });
  if (!invitation) throw notFound('Invitation');

  if (invitation.email !== userEmail.trim().toLowerCase()) {
    // Same response as "doesn't exist" — confirming that a *different* email
    // was invited would leak who else uses this app.
    throw notFound('Invitation');
  }

  const alreadyMember = await WorkspaceMember.findOne({ workspaceId: invitation.workspaceId, userId }).lean();
  if (!alreadyMember) {
    await WorkspaceMember.create({
      workspaceId: invitation.workspaceId,
      userId,
      role: invitation.role,
      invitedBy: invitation.invitedBy,
      isDefault: false,
      joinedAt: new Date(),
    });
  }

  invitation.acceptedAt = new Date();
  await invitation.save();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'Invitation',
    entityId: invitation._id,
    summary: 'Accepted a workspace invitation',
  });

  return invitation.workspaceId;
}
