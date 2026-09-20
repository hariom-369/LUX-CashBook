import { Schema, type Types } from 'mongoose';
import { DEFAULT_BUDGET_THRESHOLDS } from '@khata/shared';
import { defineModel, baseOptions, moneyField, scopeFields } from './shared.js';

/**
 * A spending limit for a category (or for everything, when `categoryId` is null).
 *
 * Consumption is never stored: it is computed from transactions inside the current
 * period at read time. A stored "spent" figure would go stale the moment a
 * historical transaction was edited or restored, which is the exact class of bug
 * §72 forbids.
 */
export interface IBudget {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  categoryId: Types.ObjectId | null;
  amountMinor: number;
  period: 'monthly' | 'weekly' | 'yearly';
  startDate: Date;
  endDate?: Date | null;
  /** Carry any unspent amount into the next period. */
  rollover: boolean;
  /** Percentages at which to notify (§29). */
  alertThresholds: number[];
  /** Highest threshold already notified this period, so alerts don't repeat. */
  lastAlertedThreshold?: number | null;
  lastAlertedPeriod?: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const budgetSchema = new Schema<IBudget>(
  {
    ...scopeFields(),
    name: { type: String, required: true, trim: true, maxlength: 60 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    amountMinor: moneyField({ required: true, signed: false }),
    period: { type: String, enum: ['monthly', 'weekly', 'yearly'], default: 'monthly' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    rollover: { type: Boolean, default: false },
    alertThresholds: {
      type: [Number],
      default: () => [...DEFAULT_BUDGET_THRESHOLDS],
      validate: {
        validator: (v: number[]) => v.every((n) => Number.isFinite(n) && n > 0 && n <= 500),
        message: 'Alert thresholds must be percentages between 1 and 500.',
      },
    },
    lastAlertedThreshold: { type: Number, default: null },
    lastAlertedPeriod: { type: String, default: null },
    isActive: { type: Boolean, default: true },
  },
  baseOptions,
);

// One active budget per category per workspace — two competing limits for the same
// category would make "remaining" meaningless.
budgetSchema.index(
  { workspaceId: 1, categoryId: 1, period: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);
budgetSchema.index({ workspaceId: 1, isActive: 1 });

export const Budget = defineModel<IBudget>('Budget', budgetSchema);
