import { Types, type HydratedDocument } from 'mongoose';
import type { AuthSessionDto, UserDto, UserPreferences } from '@khata/shared';
import { User, RefreshToken, Workspace, type IUser } from '../../models/index.js';
import { DEFAULT_PREFERENCES } from '../../models/User.js';
import { conflict, forbidden, notFound, unauthorized } from '../../lib/errors.js';
import { hashPassword, needsRehash, verifyPassword } from '../../lib/password.js';
import {
  accessTokenTtlSeconds,
  generateActionToken,
  generateRefreshToken,
  hashToken,
  signAccessToken,
} from '../../lib/tokens.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { passwordChangedEmail, passwordResetEmail, sendMail, verificationEmail } from '../../lib/mailer.js';
import { createWorkspace, toWorkspaceDto } from '../workspaces/workspace.service.js';
import { recordAudit } from '../../services/audit.service.js';
import type { RegisterInput } from './auth.schema.js';

const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_MINUTES = 15;

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface IssuedSession {
  session: AuthSessionDto;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Mongoose subdocuments expose their fields through prototype getters, not own
 * enumerable properties, so `{ ...doc.preferences }` silently yields nothing.
 * `toObject()` is the only spread-safe way to read one.
 */
function plainPreferences(preferences: IUser['preferences']): UserPreferences {
  const raw = preferences as UserPreferences & { toObject?: () => UserPreferences };
  const value = typeof raw.toObject === 'function' ? raw.toObject() : raw;
  return {
    ...DEFAULT_PREFERENCES,
    ...value,
    notifications: { ...DEFAULT_PREFERENCES.notifications, ...value?.notifications },
    security: { ...DEFAULT_PREFERENCES.security, ...value?.security },
  };
}

export function toUserDto(user: IUser): UserDto {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    emailVerified: user.emailVerified,
    onboardingCompleted: user.onboardingCompleted,
    preferences: plainPreferences(user.preferences),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export { plainPreferences };

// ─────────────────────────────────────────────── Registration

export async function register(input: RegisterInput, meta: RequestMeta): Promise<IssuedSession> {
  const existing = await User.findOne({ email: input.email }).lean();
  if (existing) {
    // Registration is not an account-enumeration oracle we can fully close (the
    // user must be told their address is taken), but we keep the wording neutral
    // and rate-limit the endpoint hard.
    throw conflict('An account with that email already exists.', 'EMAIL_TAKEN');
  }

  const passwordHash = await hashPassword(input.password);

  const user = await User.create({
    name: input.name,
    email: input.email,
    passwordHash,
    preferences: {
      ...DEFAULT_PREFERENCES,
      currency: input.currency,
      country: input.country,
      timeZone: input.timeZone,
      numberFormat: input.currency === 'INR' ? 'indian' : 'western',
    },
  });

  const workspace = await createWorkspace(user._id, {
    name: input.workspaceMode === 'business' ? 'My Business' : 'Personal',
    mode: input.workspaceMode,
    currency: input.currency,
    isDefault: true,
  });

  user.activeWorkspaceId = workspace._id;
  await user.save();

  await sendVerificationEmail(user._id).catch((err) =>
    logger.error({ err }, 'Could not send verification email at sign-up'),
  );

  await recordAudit(
    { userId: user._id, workspaceId: workspace._id, ...meta },
    { action: 'created', entityType: 'User', entityId: user._id, summary: `Account created for ${user.email}` },
  );

  return issueSession(user, meta);
}

// ─────────────────────────────────────────────── Login

export async function login(
  email: string,
  password: string,
  meta: RequestMeta,
): Promise<IssuedSession> {
  const user = await User.findOne({ email }).select(
    '+passwordHash +failedLoginAttempts +lockedUntil',
  );

  // Constant-ish work whether or not the account exists, so response timing does
  // not reveal which emails are registered.
  if (!user) {
    await hashPassword(password).catch(() => undefined);
    throw unauthorized('That email or password is not correct.', 'INVALID_CREDENTIALS');
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw forbidden(`Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }

  const valid = await verifyPassword(password, user.passwordHash);

  if (!valid) {
    user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
      user.failedLoginAttempts = 0;
      logger.warn({ userId: String(user._id) }, 'Account locked after repeated failed logins');
    }
    await user.save();
    throw unauthorized('That email or password is not correct.', 'INVALID_CREDENTIALS');
  }

  // Transparently upgrade hashes when the cost policy has been raised.
  if (needsRehash(user.passwordHash)) {
    user.passwordHash = await hashPassword(password);
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  await user.save();

  await recordAudit(
    { userId: user._id, workspaceId: user.activeWorkspaceId, ...meta },
    { action: 'login', entityType: 'User', entityId: user._id, summary: 'Signed in' },
  );

  return issueSession(user, meta);
}

// ─────────────────────────────────────────────── Session issuing & refresh

async function issueSession(
  user: HydratedDocument<IUser>,
  meta: RequestMeta,
  familyId?: string,
): Promise<IssuedSession> {
  const workspaces = await Workspace.find({ userId: user._id }).sort({ isDefault: -1, createdAt: 1 });

  // Self-heal a user whose active workspace was deleted or never set.
  let activeWorkspaceId = user.activeWorkspaceId ? String(user.activeWorkspaceId) : null;
  if (!activeWorkspaceId || !workspaces.some((w) => String(w._id) === activeWorkspaceId)) {
    activeWorkspaceId = workspaces[0] ? String(workspaces[0]._id) : null;
    if (activeWorkspaceId) {
      await User.updateOne({ _id: user._id }, { $set: { activeWorkspaceId } });
    }
  }

  const family = familyId ?? new Types.ObjectId().toString();
  const { token, hash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlMs);

  await RefreshToken.create({
    userId: user._id,
    tokenHash: hash,
    familyId: family,
    expiresAt,
    userAgent: meta.userAgent,
    ipAddress: meta.ipAddress,
  });

  const accessToken = signAccessToken({
    sub: String(user._id),
    ws: activeWorkspaceId ?? undefined,
    sid: family,
    email: user.email,
    tv: user.tokenVersion,
  });

  return {
    session: {
      user: toUserDto(user),
      workspaces: workspaces.map(toWorkspaceDto),
      activeWorkspaceId,
      accessToken,
      expiresIn: accessTokenTtlSeconds(),
    },
    refreshToken: token,
    refreshExpiresAt: expiresAt,
  };
}

/**
 * Exchange a refresh token for a new pair, rotating the old one.
 *
 * A token that has already been rotated means one of two things: a race (rare,
 * recoverable) or a stolen token being replayed (serious). We cannot tell them
 * apart, so we assume the worse case and revoke the entire family — every session
 * descended from that login dies, which is the standard and correct response.
 */
export async function refreshSession(
  presentedToken: string,
  meta: RequestMeta,
): Promise<IssuedSession> {
  const tokenHash = hashToken(presentedToken);
  const stored = await RefreshToken.findOne({ tokenHash });

  if (!stored) {
    throw unauthorized('Your session has ended. Please sign in again.', 'REFRESH_INVALID');
  }

  if (stored.revokedAt || stored.rotatedAt) {
    await RefreshToken.updateMany(
      { familyId: stored.familyId, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'reuse_detected' } },
    );
    logger.warn(
      { userId: String(stored.userId), familyId: stored.familyId },
      'Refresh token reuse detected — revoking token family',
    );
    throw unauthorized('Your session has ended. Please sign in again.', 'REFRESH_REUSED');
  }

  if (stored.expiresAt.getTime() < Date.now()) {
    stored.revokedAt = new Date();
    stored.revokedReason = 'expired';
    await stored.save();
    throw unauthorized('Your session has expired. Please sign in again.', 'REFRESH_EXPIRED');
  }

  const user = await User.findById(stored.userId);
  if (!user) {
    throw unauthorized('Your account could not be found.', 'USER_NOT_FOUND');
  }

  stored.rotatedAt = new Date();
  stored.revokedAt = new Date();
  stored.revokedReason = 'rotated';
  await stored.save();

  return issueSession(user, meta, stored.familyId);
}

export async function logout(presentedToken: string | undefined): Promise<void> {
  if (!presentedToken) return;
  await RefreshToken.updateOne(
    { tokenHash: hashToken(presentedToken), revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'logout' } },
  );
}

/** Sign out everywhere: revoke all refresh tokens and invalidate live access tokens. */
export async function logoutAllSessions(userId: Types.ObjectId): Promise<void> {
  await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'logout' } },
  );
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
}

export async function buildSessionForUser(
  userId: Types.ObjectId,
): Promise<Omit<AuthSessionDto, 'accessToken' | 'expiresIn'>> {
  const user = await User.findById(userId);
  if (!user) throw notFound('User');
  const workspaces = await Workspace.find({ userId }).sort({ isDefault: -1, createdAt: 1 });
  return {
    user: toUserDto(user),
    workspaces: workspaces.map(toWorkspaceDto),
    activeWorkspaceId: user.activeWorkspaceId ? String(user.activeWorkspaceId) : null,
  };
}

// ─────────────────────────────────────────────── Email verification

export async function sendVerificationEmail(userId: Types.ObjectId): Promise<void> {
  const user = await User.findById(userId);
  if (!user || user.emailVerified) return;

  const { token, hash, expiresAt } = generateActionToken();
  user.emailVerificationTokenHash = hash;
  user.emailVerificationExpiresAt = expiresAt;
  await user.save();

  const url = `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail({ to: user.email, ...verificationEmail(user.name, url) });
}

export async function verifyEmail(token: string): Promise<void> {
  const user = await User.findOne({ emailVerificationTokenHash: hashToken(token) }).select(
    '+emailVerificationTokenHash +emailVerificationExpiresAt',
  );

  if (!user || !user.emailVerificationExpiresAt || user.emailVerificationExpiresAt.getTime() < Date.now()) {
    throw unauthorized('That confirmation link is invalid or has expired.', 'VERIFICATION_INVALID');
  }

  user.emailVerified = true;
  user.emailVerificationTokenHash = null;
  user.emailVerificationExpiresAt = null;
  await user.save();
}

// ─────────────────────────────────────────────── Password reset

/**
 * Always resolves successfully, whether or not the address is registered.
 *
 * Telling an anonymous caller "no account with that email" turns this endpoint into
 * a free membership oracle, so the response is identical either way and the work is
 * done in the background.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await User.findOne({ email });
  if (!user) {
    logger.info({ email }, 'Password reset requested for unknown address (no email sent)');
    return;
  }

  const { token, hash, expiresAt } = generateActionToken();
  user.passwordResetTokenHash = hash;
  user.passwordResetExpiresAt = expiresAt;
  await user.save();

  const url = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail({ to: user.email, ...passwordResetEmail(user.name, url) });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const user = await User.findOne({ passwordResetTokenHash: hashToken(token) }).select(
    '+passwordResetTokenHash +passwordResetExpiresAt +passwordHash',
  );

  if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt.getTime() < Date.now()) {
    throw unauthorized('That reset link is invalid or has expired.', 'RESET_INVALID');
  }

  user.passwordHash = await hashPassword(newPassword);
  user.passwordResetTokenHash = null;
  user.passwordResetExpiresAt = null;
  user.passwordChangedAt = new Date();
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  // Anyone holding a session from before the reset loses it — that is the point.
  user.tokenVersion += 1;
  await user.save();

  await RefreshToken.updateMany(
    { userId: user._id, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'password_change' } },
  );

  await sendMail({ to: user.email, ...passwordChangedEmail(user.name) }).catch(() => undefined);
}

export async function changePassword(
  userId: Types.ObjectId,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw notFound('User');

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    throw unauthorized('Your current password is not correct.', 'INVALID_CREDENTIALS');
  }

  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  user.tokenVersion += 1;
  await user.save();

  await RefreshToken.updateMany(
    { userId: user._id, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'password_change' } },
  );

  await sendMail({ to: user.email, ...passwordChangedEmail(user.name) }).catch(() => undefined);
}

// ─────────────────────────────────────────────── App-lock PIN

export async function setPin(userId: Types.ObjectId, pin: string, password: string): Promise<void> {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw notFound('User');

  if (!(await verifyPassword(password, user.passwordHash))) {
    throw unauthorized('Your password is not correct.', 'INVALID_CREDENTIALS');
  }

  user.pinHash = await hashPassword(pin);
  user.set('preferences.security.pinEnabled', true);
  await user.save();
}

export async function removePin(userId: Types.ObjectId, password: string): Promise<void> {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw notFound('User');

  if (!(await verifyPassword(password, user.passwordHash))) {
    throw unauthorized('Your password is not correct.', 'INVALID_CREDENTIALS');
  }

  user.pinHash = null;
  user.set('preferences.security.pinEnabled', false);
  user.set('preferences.security.biometricEnabled', false);
  await user.save();
}

/**
 * Verify the app-lock PIN.
 *
 * This unlocks the UI for an already-authenticated session — it is not an
 * authentication factor on its own, and it deliberately grants no new API access.
 */
export async function verifyPin(userId: Types.ObjectId, pin: string): Promise<boolean> {
  const user = await User.findById(userId).select('+pinHash');
  if (!user?.pinHash) return false;
  return verifyPassword(pin, user.pinHash);
}
