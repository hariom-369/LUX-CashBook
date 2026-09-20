import { Schema, type Types } from 'mongoose';
import { REMINDER_TYPES, type ReminderType } from '@khata/shared';
import { defineModel, baseOptions, moneyField, scopeFields } from './shared.js';

/**
 * A dated prompt (§18): a loan coming due, a bill, a subscription renewal.
 *
 * Reminders attached to a loan or a recurring template are *derived* — the system
 * creates and retires them as the underlying record changes — while `custom`
 * reminders are owned entirely by the user. `sourceKey` is what lets the generator
 * recognise a reminder it already created instead of producing a duplicate on
 * every run.
 */
export interface IReminder {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  type: ReminderType;
  title: string;
  amountMinor?: number;
  dueDate: Date;
  personId?: Types.ObjectId | null;
  transactionId?: Types.ObjectId | null;
  recurringId?: Types.ObjectId | null;
  notes?: string;
  notifyDaysBefore: number;
  /** Stable identity for generated reminders, e.g. `loan:<txnId>`. */
  sourceKey?: string | null;
  isDone: boolean;
  completedAt?: Date | null;
  lastNotifiedAt?: Date | null;
  isDismissed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const reminderSchema = new Schema<IReminder>(
  {
    ...scopeFields(),
    type: { type: String, enum: REMINDER_TYPES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    amountMinor: moneyField({ signed: false }),
    dueDate: { type: Date, required: true },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', default: null },
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
    recurringId: { type: Schema.Types.ObjectId, ref: 'RecurringTransaction', default: null },
    notes: { type: String, trim: true, maxlength: 500 },
    notifyDaysBefore: { type: Number, min: 0, max: 60, default: 1 },
    sourceKey: { type: String, default: null, maxlength: 120 },
    isDone: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
    lastNotifiedAt: { type: Date, default: null },
    isDismissed: { type: Boolean, default: false },
  },
  baseOptions,
);

reminderSchema.index({ workspaceId: 1, isDone: 1, dueDate: 1 });
reminderSchema.index(
  { workspaceId: 1, sourceKey: 1 },
  { unique: true, partialFilterExpression: { sourceKey: { $type: 'string' } } },
);
/** The notifier's sweep: everything due soon that hasn't been announced yet. */
reminderSchema.index({ isDone: 1, dueDate: 1, lastNotifiedAt: 1 });

export const Reminder = defineModel<IReminder>('Reminder', reminderSchema);
