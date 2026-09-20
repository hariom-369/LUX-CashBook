import { z } from 'zod';
import { CURRENCIES, WORKSPACE_MODES } from '@khata/shared';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../lib/password.js';

const email = z
  .string({ required_error: 'Enter your email address.' })
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(254);

const password = z
  .string({ required_error: 'Enter a password.' })
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, 'That password is too long.');

const currency = z
  .string()
  .toUpperCase()
  .refine((c) => c in CURRENCIES, 'That currency is not supported yet.');

export const registerSchema = z.object({
  name: z.string({ required_error: 'Enter your name.' }).trim().min(1, 'Enter your name.').max(80),
  email,
  password,
  currency: currency.default('INR'),
  country: z.string().trim().toUpperCase().length(2).default('IN'),
  timeZone: z.string().trim().max(64).default('Asia/Kolkata'),
  /** Optional: what the user picked on the welcome screen (§66). */
  workspaceMode: z.enum(WORKSPACE_MODES).default('personal'),
});

export const loginSchema = z.object({
  email,
  password: z.string({ required_error: 'Enter your password.' }).min(1, 'Enter your password.'),
  /** Longer-lived refresh cookie when the user asks to stay signed in. */
  rememberMe: z.boolean().default(true),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(16, 'That reset link is not valid.'),
  password,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(16, 'That confirmation link is not valid.'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: password,
});

export const setPinSchema = z.object({
  /** 4–8 digits. Used for the app lock, not for API authentication. */
  pin: z
    .string()
    .regex(/^\d{4,8}$/, 'Choose a PIN of 4 to 8 digits.')
    .refine((p) => !/^(\d)\1+$/.test(p), 'Choose a less predictable PIN.')
    .refine((p) => !['1234', '12345', '123456', '0000'].includes(p), 'Choose a less predictable PIN.'),
  /** Confirms identity before changing a security setting. */
  password: z.string().min(1, 'Enter your password to confirm.'),
});

export const verifyPinSchema = z.object({
  pin: z.string().regex(/^\d{4,8}$/, 'Enter your PIN.'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
