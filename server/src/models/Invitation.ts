import { Schema, type Types } from 'mongoose';
import { WORKSPACE_ROLES, type WorkspaceRole } from '@khata/shared';
import { defineModel, baseOptions } from './shared.js';

/**
 * A pending invite to join a household workspace (§Phase 9). Only the
 * SHA-256 hash of the invite token is stored — same convention as email
 * verification and password reset (`lib/tokens.ts`) — so a database dump
 * never hands out a live invite link.
 */
export interface IInvitation {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  email: string;
  role: WorkspaceRole;
  invitedBy: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const invitationSchema = new Schema<IInvitation>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    role: { type: String, enum: WORKSPACE_ROLES, required: true, default: 'member' },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
  },
  baseOptions,
);

invitationSchema.index({ workspaceId: 1, email: 1, acceptedAt: 1 });
invitationSchema.index({ tokenHash: 1 });
// Expired, never-accepted invitations are useless after the fact — let MongoDB clean them up.
invitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { acceptedAt: null } });

export const Invitation = defineModel<IInvitation>('Invitation', invitationSchema);
