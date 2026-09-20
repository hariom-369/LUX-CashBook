import { Schema, type HydratedDocument, type Types } from 'mongoose';
import { defineModel, baseOptions, colorField, moneyField, scopeFields } from './shared.js';

/**
 * A savings target (§30).
 *
 * Two ways to track progress, and the model supports both:
 *  • `linkedAccountId` set — progress mirrors that account's live balance.
 *  • no link — the user records contributions, which accumulate in `contributions`.
 *
 * Contributions are stored as rows rather than a running total so the goal's
 * history is auditable and a mistaken contribution can be removed cleanly.
 */
export interface IGoalContribution {
  _id: Types.ObjectId;
  amountMinor: number;
  date: Date;
  note?: string;
  transactionId?: Types.ObjectId | null;
}

export interface ISavingsGoal {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  targetMinor: number;
  targetDate?: Date | null;
  icon: string;
  color: string;
  linkedAccountId?: Types.ObjectId | null;
  contributions: IGoalContribution[];
  notes?: string;
  isAchieved: boolean;
  achievedAt?: Date | null;
  isArchived: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const contributionSchema = new Schema<IGoalContribution>({
  amountMinor: moneyField({ required: true }),
  date: { type: Date, required: true, default: () => new Date() },
  note: { type: String, trim: true, maxlength: 200 },
  transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
});

const savingsGoalSchema = new Schema<ISavingsGoal>(
  {
    ...scopeFields(),
    name: { type: String, required: true, trim: true, maxlength: 60 },
    targetMinor: moneyField({ required: true, signed: false }),
    targetDate: { type: Date, default: null },
    icon: { type: String, default: 'Target', maxlength: 48 },
    color: colorField,
    linkedAccountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    contributions: { type: [contributionSchema], default: [] },
    notes: { type: String, trim: true, maxlength: 1000 },
    isAchieved: { type: Boolean, default: false },
    achievedAt: { type: Date, default: null },
    isArchived: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  baseOptions,
);

savingsGoalSchema.index({ workspaceId: 1, isArchived: 1, sortOrder: 1 });

savingsGoalSchema.pre('validate', function (this: HydratedDocument<ISavingsGoal>, next) {
  if (!(this.targetMinor > 0)) return next(new Error('Set a target amount greater than zero.'));
  next();
});

/** Sum of manual contributions. Ignored when the goal tracks an account balance. */
savingsGoalSchema.virtual('contributedMinor').get(function (this: ISavingsGoal) {
  return this.contributions.reduce((sum, c) => sum + c.amountMinor, 0);
});

export const SavingsGoal = defineModel<ISavingsGoal>('SavingsGoal', savingsGoalSchema);
