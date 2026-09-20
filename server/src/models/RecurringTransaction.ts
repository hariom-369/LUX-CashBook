import { Schema, type HydratedDocument, type Types } from 'mongoose';
import {
  PAYMENT_METHODS,
  RECURRENCE_FREQUENCIES,
  TRANSACTION_TYPES,
  type PaymentMethod,
  type RecurrenceFrequency,
  type TransactionType,
} from '@khata/shared';
import { defineModel, baseOptions, moneyField, scopeFields, tagsField } from './shared.js';

/**
 * A template that posts transactions on a schedule (§21).
 *
 * The scheduler is driven entirely by `nextRunDate`: it claims due templates with a
 * conditional update, posts the transaction, then advances the date. Because the
 * claim and the advance are guarded on the value the worker read, running two
 * schedulers (or restarting mid-run) cannot post the same occurrence twice — which
 * matters more here than almost anywhere else in the app.
 */
export interface IRecurringTransaction {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;

  name: string;
  type: TransactionType;
  amountMinor: number;
  accountId: Types.ObjectId;
  /** Transfers only. */
  toAccountId?: Types.ObjectId | null;
  categoryId?: Types.ObjectId | null;
  subcategoryId?: Types.ObjectId | null;
  personId?: Types.ObjectId | null;
  description: string;
  notes?: string;
  paymentMethod?: PaymentMethod;
  tags: string[];

  frequency: RecurrenceFrequency;
  /** `custom` only: repeat every N days. */
  intervalDays?: number | null;
  /** `weekly`: 0–6. */
  dayOfWeek?: number | null;
  /** `monthly`/`yearly`: 1–31, clamped to the month's length. */
  dayOfMonth?: number | null;
  /** `yearly`: 1–12. */
  monthOfYear?: number | null;

  startDate: Date;
  endDate?: Date | null;
  nextRunDate: Date;
  lastRunDate?: Date | null;

  /** Post automatically, or only raise a reminder for the user to confirm. */
  autoPost: boolean;
  reminderDaysBefore: number;

  isActive: boolean;
  isPaused: boolean;
  occurrencesCreated: number;
  maxOccurrences?: number | null;
  lastError?: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const recurringSchema = new Schema<IRecurringTransaction>(
  {
    ...scopeFields(),
    name: { type: String, required: true, trim: true, maxlength: 60 },
    type: { type: String, enum: TRANSACTION_TYPES, required: true },
    amountMinor: moneyField({ required: true, signed: false }),
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    toAccountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    subcategoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', default: null },
    description: { type: String, trim: true, maxlength: 200, default: '' },
    notes: { type: String, trim: true, maxlength: 2000 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS },
    tags: tagsField,

    frequency: { type: String, enum: RECURRENCE_FREQUENCIES, required: true },
    intervalDays: { type: Number, min: 1, max: 3650, default: null },
    dayOfWeek: { type: Number, min: 0, max: 6, default: null },
    dayOfMonth: { type: Number, min: 1, max: 31, default: null },
    monthOfYear: { type: Number, min: 1, max: 12, default: null },

    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    nextRunDate: { type: Date, required: true },
    lastRunDate: { type: Date, default: null },

    autoPost: { type: Boolean, default: true },
    reminderDaysBefore: { type: Number, min: 0, max: 30, default: 1 },

    isActive: { type: Boolean, default: true },
    isPaused: { type: Boolean, default: false },
    occurrencesCreated: { type: Number, default: 0 },
    maxOccurrences: { type: Number, min: 1, default: null },
    lastError: { type: String, default: null, maxlength: 500 },
  },
  baseOptions,
);

/** The scheduler's only query: everything live and due. */
recurringSchema.index({ isActive: 1, isPaused: 1, nextRunDate: 1 });
recurringSchema.index({ workspaceId: 1, isActive: 1, nextRunDate: 1 });

recurringSchema.pre('validate', function (this: HydratedDocument<IRecurringTransaction>, next) {
  if (this.frequency === 'custom' && !this.intervalDays) {
    return next(new Error('A custom schedule needs a repeat interval in days.'));
  }
  if (this.type === 'transfer' && !this.toAccountId) {
    return next(new Error('A recurring transfer needs a destination account.'));
  }
  if (this.type === 'transfer' && String(this.toAccountId) === String(this.accountId)) {
    return next(new Error('Choose two different accounts for a transfer.'));
  }
  if (this.endDate && this.endDate < this.startDate) {
    return next(new Error('The end date must be after the start date.'));
  }
  next();
});

export const RecurringTransaction = defineModel<IRecurringTransaction>(
  'RecurringTransaction',
  recurringSchema,
);
