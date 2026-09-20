import { z } from 'zod';
import { CURRENCIES, DATE_FORMATS, THEMES } from '@khata/shared';

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(80).optional(),
  phone: z
    .string()
    .trim()
    .max(24)
    .regex(/^[+\d][\d\s-]*$/, 'Enter a valid phone number.')
    .optional()
    .or(z.literal('')),
  avatarUrl: z.string().url('Enter a valid image URL.').max(512).optional().or(z.literal('')),
});

/**
 * Preferences are patched field by field — a client sending only `{ theme }` must
 * not blank out the rest, so every key is optional and the service merges deeply.
 */
export const updatePreferencesSchema = z
  .object({
    currency: z
      .string()
      .toUpperCase()
      .refine((c) => c in CURRENCIES, 'That currency is not supported yet.')
      .optional(),
    country: z.string().trim().toUpperCase().length(2).optional(),
    dateFormat: z.enum(DATE_FORMATS).optional(),
    firstDayOfWeek: z.number().int().min(0).max(6).optional(),
    timeZone: z.string().trim().max(64).optional(),
    theme: z.enum(THEMES).optional(),
    language: z.string().trim().max(8).optional(),
    accountingView: z.boolean().optional(),
    privacyModeDefault: z.boolean().optional(),
    numberFormat: z.enum(['indian', 'western']).optional(),
    notifications: z
      .object({
        inApp: z.boolean().optional(),
        email: z.boolean().optional(),
        push: z.boolean().optional(),
        moneyDue: z.boolean().optional(),
        budgetAlerts: z.boolean().optional(),
        recurringReminders: z.boolean().optional(),
        monthlySummary: z.boolean().optional(),
        dueLeadDays: z.number().int().min(0).max(30).optional(),
      })
      .optional(),
    security: z
      .object({
        biometricEnabled: z.boolean().optional(),
        sessionTimeoutMinutes: z.number().int().min(0).max(1440).optional(),
      })
      .optional(),
  })
  .strict();

export const completeOnboardingSchema = z.object({
  activeWorkspaceId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
});

export const setActiveWorkspaceSchema = z.object({
  workspaceId: z.string().regex(/^[a-f\d]{24}$/i, 'That workspace reference is not valid.'),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Enter your password to confirm.'),
  /** Must be the literal word, typed by the user. */
  confirmation: z.literal('DELETE', {
    errorMap: () => ({ message: 'Type DELETE to confirm.' }),
  }),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
