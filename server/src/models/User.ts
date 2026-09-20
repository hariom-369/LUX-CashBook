import { Schema, type HydratedDocument, type Types } from 'mongoose';
import { DATE_FORMATS, DEFAULT_CURRENCY, THEMES, type UserPreferences } from '@khata/shared';
import { defineModel, baseOptions } from './shared.js';

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  /** scrypt hash — see `lib/password.ts`. Never selected by default. */
  passwordHash: string;
  phone?: string;
  avatarUrl?: string;

  emailVerified: boolean;
  emailVerificationTokenHash?: string | null;
  emailVerificationExpiresAt?: Date | null;

  passwordResetTokenHash?: string | null;
  passwordResetExpiresAt?: Date | null;
  passwordChangedAt?: Date | null;

  /**
   * Bumped whenever every live session must die (password change, "sign out
   * everywhere"). Access tokens carry the value they were minted with, so a stale
   * token is rejected without a database lookup per request.
   */
  tokenVersion: number;

  /** App-lock PIN (§37). Hashed with the same scrypt routine as the password. */
  pinHash?: string | null;

  failedLoginAttempts: number;
  lockedUntil?: Date | null;
  lastLoginAt?: Date | null;

  onboardingCompleted: boolean;
  activeWorkspaceId?: Types.ObjectId | null;
  preferences: UserPreferences;

  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<IUser>;

export const DEFAULT_PREFERENCES: UserPreferences = {
  currency: DEFAULT_CURRENCY,
  country: 'IN',
  dateFormat: 'dd MMM yyyy',
  firstDayOfWeek: 1,
  timeZone: 'Asia/Kolkata',
  theme: 'system',
  language: 'en',
  accountingView: false,
  privacyModeDefault: false,
  numberFormat: 'indian',
  notifications: {
    inApp: true,
    email: true,
    push: false,
    moneyDue: true,
    budgetAlerts: true,
    recurringReminders: true,
    monthlySummary: true,
    dueLeadDays: 1,
  },
  security: {
    pinEnabled: false,
    biometricEnabled: false,
    sessionTimeoutMinutes: 0,
  },
};

const preferencesSchema = new Schema<UserPreferences>(
  {
    currency: { type: String, default: DEFAULT_CURRENCY, uppercase: true, minlength: 3, maxlength: 3 },
    country: { type: String, default: 'IN', uppercase: true, maxlength: 2 },
    dateFormat: { type: String, enum: DATE_FORMATS, default: 'dd MMM yyyy' },
    firstDayOfWeek: { type: Number, min: 0, max: 6, default: 1 },
    timeZone: { type: String, default: 'Asia/Kolkata', maxlength: 64 },
    theme: { type: String, enum: THEMES, default: 'system' },
    language: { type: String, default: 'en', maxlength: 8 },
    accountingView: { type: Boolean, default: false },
    privacyModeDefault: { type: Boolean, default: false },
    numberFormat: { type: String, enum: ['indian', 'western'], default: 'indian' },
    notifications: {
      inApp: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: false },
      moneyDue: { type: Boolean, default: true },
      budgetAlerts: { type: Boolean, default: true },
      recurringReminders: { type: Boolean, default: true },
      monthlySummary: { type: Boolean, default: true },
      dueLeadDays: { type: Number, min: 0, max: 30, default: 1 },
    },
    security: {
      pinEnabled: { type: Boolean, default: false },
      biometricEnabled: { type: Boolean, default: false },
      sessionTimeoutMinutes: { type: Number, min: 0, max: 1440, default: 0 },
    },
  },
  { _id: false },
);

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address.'],
    },
    // `select: false` so a stray `User.findById()` can never serialise a hash.
    passwordHash: { type: String, required: true, select: false },
    phone: { type: String, trim: true, maxlength: 24 },
    avatarUrl: { type: String, maxlength: 512 },

    emailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, default: null, select: false },
    emailVerificationExpiresAt: { type: Date, default: null, select: false },

    passwordResetTokenHash: { type: String, default: null, select: false },
    passwordResetExpiresAt: { type: Date, default: null, select: false },
    passwordChangedAt: { type: Date, default: null },

    tokenVersion: { type: Number, default: 0 },
    pinHash: { type: String, default: null, select: false },

    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, default: null, select: false },
    lastLoginAt: { type: Date, default: null },

    onboardingCompleted: { type: Boolean, default: false },
    activeWorkspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
    preferences: { type: preferencesSchema, default: () => ({}) },
  },
  baseOptions,
);

// Reset-token lookups happen on an unauthenticated route, so they must be indexed
// to stay cheap under abuse.
userSchema.index({ passwordResetTokenHash: 1 }, { sparse: true });
userSchema.index({ emailVerificationTokenHash: 1 }, { sparse: true });

userSchema.virtual('isLocked').get(function (this: IUser) {
  return Boolean(this.lockedUntil && this.lockedUntil.getTime() > Date.now());
});

export const User = defineModel<IUser>('User', userSchema);
