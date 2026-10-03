import { Schema, type Types } from 'mongoose';
import { WORKSPACE_ROLES, type WorkspaceRole } from '@khata/shared';
import { defineModel, baseOptions } from './shared.js';

/**
 * Membership is the real access-control boundary for a workspace, once
 * household sharing exists (§Phase 9, decision 4) — `requireWorkspace` checks
 * this, not `Workspace.userId` directly. `Workspace.userId` stays as "the
 * original owner" for display and billing purposes; it is never removed and
 * never used for authorization once this model exists.
 */
export interface IWorkspaceMember {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  role: WorkspaceRole;
  invitedBy?: Types.ObjectId | null;
  /**
   * Which workspace this member lands on at login — per-membership, not on
   * `Workspace` itself: a shared workspace can be one member's default and
   * not another's, so a single shared flag on `Workspace` would let one
   * member's preference silently change everyone else's.
   */
  isDefault: boolean;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const workspaceMemberSchema = new Schema<IWorkspaceMember>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: WORKSPACE_ROLES, required: true, default: 'member' },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDefault: { type: Boolean, default: false },
    joinedAt: { type: Date, default: () => new Date() },
  },
  baseOptions,
);

// One membership row per (workspace, user) — never two competing roles for the same person.
// `userId` already has a field-level index (above) for "every workspace this
// user belongs to"; this one is additionally unique, so a user can't end up
// with two competing roles in the same workspace.
workspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

export const WorkspaceMember = defineModel<IWorkspaceMember>('WorkspaceMember', workspaceMemberSchema);
