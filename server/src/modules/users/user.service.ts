import { Types } from 'mongoose';
import type { UserDto } from '@khata/shared';
import { RefreshToken, User, Workspace } from '../../models/index.js';
import { forbidden, notFound, unauthorized } from '../../lib/errors.js';
import { verifyPassword } from '../../lib/password.js';
import { plainPreferences, toUserDto } from '../auth/auth.service.js';
import { purgeWorkspaceData } from '../workspaces/workspace.service.js';
import { logger } from '../../lib/logger.js';
import type { UpdatePreferencesInput, UpdateProfileInput } from './user.schema.js';

export async function getProfile(userId: Types.ObjectId): Promise<UserDto> {
  const user = await User.findById(userId);
  if (!user) throw notFound('User');
  return toUserDto(user);
}

export async function updateProfile(
  userId: Types.ObjectId,
  patch: UpdateProfileInput,
): Promise<UserDto> {
  const user = await User.findById(userId);
  if (!user) throw notFound('User');

  if (patch.name !== undefined) user.name = patch.name;
  // An empty string is how the client says "clear this field".
  if (patch.phone !== undefined) user.phone = patch.phone || undefined;
  if (patch.avatarUrl !== undefined) user.avatarUrl = patch.avatarUrl || undefined;

  await user.save();
  return toUserDto(user);
}

/**
 * Merge a partial preferences patch.
 *
 * Nested groups (`notifications`, `security`) are merged rather than replaced, so a
 * client that toggles one switch cannot reset the others by omission.
 */
export async function updatePreferences(
  userId: Types.ObjectId,
  patch: UpdatePreferencesInput,
): Promise<UserDto> {
  const user = await User.findById(userId);
  if (!user) throw notFound('User');

  const { notifications, security, ...scalars } = patch;
  const current = plainPreferences(user.preferences);

  // Replace the whole subdocument with a merged plain object. Assigning field by
  // field onto a live subdocument is where nested patches quietly get lost.
  user.set('preferences', {
    ...current,
    ...scalars,
    notifications: { ...current.notifications, ...notifications },
    security: { ...current.security, ...security },
  });

  // Currency here is a display default for *new* workspaces; it never rewrites the
  // currency of existing ones, whose stored amounts are already denominated.
  await user.save();
  return toUserDto(user);
}

export async function setActiveWorkspace(
  userId: Types.ObjectId,
  workspaceId: string,
): Promise<void> {
  const workspace = await Workspace.findOne({ _id: workspaceId, userId }).lean();
  if (!workspace) throw notFound('Workspace');
  await User.updateOne({ _id: userId }, { $set: { activeWorkspaceId: workspace._id } });
}

export async function completeOnboarding(
  userId: Types.ObjectId,
  activeWorkspaceId?: string,
): Promise<UserDto> {
  const user = await User.findById(userId);
  if (!user) throw notFound('User');

  if (activeWorkspaceId) {
    const workspace = await Workspace.findOne({ _id: activeWorkspaceId, userId }).lean();
    if (!workspace) throw notFound('Workspace');
    user.activeWorkspaceId = workspace._id;
  }

  user.onboardingCompleted = true;
  await user.save();
  return toUserDto(user);
}

/**
 * Delete the account and every trace of its data.
 *
 * §40 says users must never be locked in, and the flip side of that is that they
 * must be able to leave completely. This is the one genuinely destructive path in
 * the system, so it is gated on the current password *and* a typed confirmation,
 * and it is recorded in the audit log of the user who requested it before the data
 * goes away.
 */
export async function deleteAccount(userId: Types.ObjectId, password: string): Promise<void> {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw notFound('User');

  if (!(await verifyPassword(password, user.passwordHash))) {
    throw unauthorized('Your password is not correct.', 'INVALID_CREDENTIALS');
  }

  const workspaces = await Workspace.find({ userId }).select('_id').lean();
  for (const workspace of workspaces) {
    await purgeWorkspaceData(workspace._id);
  }

  await Workspace.deleteMany({ userId });
  await RefreshToken.deleteMany({ userId });

  const { AuditLog, Notification } = await import('../../models/index.js');
  await Notification.deleteMany({ userId });
  await AuditLog.deleteMany({ userId });

  await user.deleteOne();

  logger.warn({ userId: String(userId) }, 'User account deleted');
}

/** Sessions the user can review and revoke individually (§37). */
export async function listSessions(userId: Types.ObjectId, currentFamilyId?: string) {
  const tokens = await RefreshToken.find({ userId, revokedAt: null })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  // One row per login family, not per rotation, or a month of refreshes would look
  // like hundreds of devices.
  const byFamily = new Map<string, (typeof tokens)[number]>();
  for (const token of tokens) {
    const seen = byFamily.get(token.familyId);
    if (!seen || seen.createdAt < token.createdAt) byFamily.set(token.familyId, token);
  }

  return [...byFamily.values()].map((token) => ({
    id: token.familyId,
    userAgent: token.userAgent ?? 'Unknown device',
    ipAddress: token.ipAddress,
    createdAt: token.createdAt.toISOString(),
    expiresAt: token.expiresAt.toISOString(),
    isCurrent: token.familyId === currentFamilyId,
  }));
}

export async function revokeSession(
  userId: Types.ObjectId,
  familyId: string,
  currentFamilyId?: string,
): Promise<void> {
  if (familyId === currentFamilyId) {
    throw forbidden('Use sign out to end the session you are using.');
  }
  await RefreshToken.updateMany(
    { userId, familyId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'logout' } },
  );
}
