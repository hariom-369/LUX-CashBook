import { Schema, type Types } from 'mongoose';
import { defineModel, baseOptions } from './shared.js';

/**
 * A single refresh token in a rotating family.
 *
 * `familyId` groups every token descended from one login. Presenting a token that
 * has already been rotated is the classic signal of a stolen token, so the whole
 * family is revoked rather than just the replayed token — the legitimate user is
 * logged out too, which is the correct outcome when a session is compromised.
 */
export interface IRefreshToken {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** SHA-256 of the opaque token. The token itself is never stored. */
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  /** Set when this token is exchanged for a new one. */
  rotatedAt?: Date | null;
  revokedAt?: Date | null;
  revokedReason?: 'rotated' | 'logout' | 'reuse_detected' | 'password_change' | 'expired' | null;
  userAgent?: string;
  ipAddress?: string;
  createdAt: Date;
  updatedAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    rotatedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
    userAgent: { type: String, maxlength: 256 },
    ipAddress: { type: String, maxlength: 64 },
  },
  baseOptions,
);

// Let MongoDB clear out expired tokens so the collection doesn't grow forever.
// A 7-day grace period keeps recently-expired tokens around long enough for
// reuse detection to still fire on them.
refreshTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60, name: 'refresh_token_ttl' },
);

export const RefreshToken = defineModel<IRefreshToken>('RefreshToken', refreshTokenSchema);
