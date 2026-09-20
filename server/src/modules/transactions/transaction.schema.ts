import { z } from 'zod';
import { PAYMENT_METHODS, TRANSACTION_TYPES } from '@khata/shared';
import {
  amountMinorSchema,
  csvArray,
  csvObjectIds,
  dateSchema,
  objectIdSchema,
  positiveAmountSchema,
  tagsSchema,
  text,
} from '../../middleware/validate.js';

export const createTransactionSchema = z
  .object({
    type: z.enum(TRANSACTION_TYPES),
    amountMinor: positiveAmountSchema,
    date: dateSchema,
    accountId: objectIdSchema,
    toAccountId: objectIdSchema.optional(),
    categoryId: objectIdSchema.nullable().optional(),
    subcategoryId: objectIdSchema.nullable().optional(),
    personId: objectIdSchema.nullable().optional(),
    description: text(200),
    notes: text(2000),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    referenceNo: text(60),
    tags: tagsSchema,
    attachmentIds: z.array(objectIdSchema).max(10).optional(),
    dueDate: dateSchema.nullable().optional(),
    parentTransactionId: objectIdSchema.nullable().optional(),
    discountMinor: amountMinorSchema.refine((n) => n >= 0, 'Discount cannot be negative.').optional(),
    direction: z.enum(['in', 'out']).optional(),
    /** Makes a retried submit idempotent (§51). */
    idempotencyKey: z.string().min(8).max(64).optional(),
  })
  // Cross-field rules live here rather than in the service, so the client gets a
  // field-level message instead of a generic 400 it has to interpret.
  .superRefine((value, ctx) => {
    if (value.type === 'transfer' && !value.toAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toAccountId'],
        message: 'Choose the account the money is going to.',
      });
    }
    if (value.type === 'transfer' && value.toAccountId === value.accountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toAccountId'],
        message: 'Choose two different accounts.',
      });
    }
    const personTypes = ['lend', 'borrow', 'repayment_given', 'repayment_received'];
    if (personTypes.includes(value.type) && !value.personId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['personId'],
        message: 'Choose who this involves.',
      });
    }
    // Lending is not an expense and borrowing is not income (invariant I6).
    if (personTypes.includes(value.type) && value.categoryId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['categoryId'],
        message: 'Lending and borrowing are not categorised as income or expense.',
      });
    }
    if (value.type === 'adjustment' && !value.direction) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['direction'],
        message: 'Say whether this increases or decreases the balance.',
      });
    }
  });

/** The type is intentionally absent: a transaction's type is immutable. */
export const updateTransactionSchema = z.object({
  amountMinor: positiveAmountSchema.optional(),
  date: dateSchema.optional(),
  accountId: objectIdSchema.optional(),
  toAccountId: objectIdSchema.optional(),
  categoryId: objectIdSchema.nullable().optional(),
  subcategoryId: objectIdSchema.nullable().optional(),
  description: text(200),
  notes: text(2000),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  referenceNo: text(60),
  tags: tagsSchema,
  dueDate: dateSchema.nullable().optional(),
  discountMinor: amountMinorSchema.optional(),
});

export const listTransactionsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  types: csvArray(TRANSACTION_TYPES),
  accountIds: csvObjectIds,
  categoryIds: csvObjectIds,
  personIds: csvObjectIds,
  tags: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v)),
  minAmountMinor: z.coerce.number().int().optional(),
  maxAmountMinor: z.coerce.number().int().optional(),
  search: z.string().trim().max(120).optional(),
  sortBy: z.enum(['date', 'amount', 'created']).default('date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  includeDeleted: z.coerce.boolean().default(false),
  onlyDeleted: z.coerce.boolean().default(false),
  hasAttachment: z.coerce.boolean().optional(),
  outstandingOnly: z.coerce.boolean().optional(),
});

export const duplicateTransactionSchema = z.object({
  /** Defaults to today, because a duplicate is nearly always "the same, now" (§44). */
  date: dateSchema.optional(),
  amountMinor: positiveAmountSchema.optional(),
});

export type CreateTransactionBody = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionBody = z.infer<typeof updateTransactionSchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsSchema>;
