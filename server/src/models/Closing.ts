import { Schema, type Types } from 'mongoose';
import { defineModel, baseOptions, moneyField, scopeFields } from './shared.js';

/**
 * End-of-day cash reconciliation (§32).
 *
 * A closing is a *record of a count*, not an adjustment. If the drawer is short,
 * the difference is stored here and — only if the user chooses to — a separate
 * `adjustment` transaction is posted and linked. That separation is deliberate:
 * silently writing off a shortfall would make the ledger stop matching reality,
 * and the shortfall itself is the thing the user needs to see.
 */
export interface IDayClosing {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  /** Local calendar date, normalised to midnight. */
  date: Date;
  /** Which cash accounts this count covers. Empty = every cash account. */
  accountIds: Types.ObjectId[];
  openingCashMinor: number;
  cashReceivedMinor: number;
  cashPaidMinor: number;
  expectedClosingMinor: number;
  actualClosingMinor: number;
  /** actual − expected. Negative = short. */
  differenceMinor: number;
  adjustmentTransactionId?: Types.ObjectId | null;
  note?: string;
  closedAt: Date;
  /** Reopening is allowed and recorded; history is never rewritten. */
  reopenedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const dayClosingSchema = new Schema<IDayClosing>(
  {
    ...scopeFields(),
    date: { type: Date, required: true },
    accountIds: { type: [Schema.Types.ObjectId], ref: 'Account', default: [] },
    openingCashMinor: moneyField({ default: 0 }),
    cashReceivedMinor: moneyField({ default: 0, signed: false }),
    cashPaidMinor: moneyField({ default: 0, signed: false }),
    expectedClosingMinor: moneyField({ default: 0 }),
    actualClosingMinor: moneyField({ default: 0 }),
    differenceMinor: moneyField({ default: 0 }),
    adjustmentTransactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
    note: { type: String, trim: true, maxlength: 500 },
    closedAt: { type: Date, default: () => new Date() },
    reopenedAt: { type: Date, default: null },
  },
  baseOptions,
);

dayClosingSchema.index({ workspaceId: 1, date: -1 }, { unique: true });

export const DayClosing = defineModel<IDayClosing>('DayClosing', dayClosingSchema);

/**
 * Month-end snapshot (§33).
 *
 * Closing a month freezes a summary and blocks new writes into that period; it does
 * *not* touch a single historical transaction. Reopening is a recorded action.
 */
export interface IMonthClosing {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  year: number;
  /** 1–12. */
  month: number;
  openingBalanceMinor: number;
  totalReceiptsMinor: number;
  totalPaymentsMinor: number;
  closingBalanceMinor: number;
  incomeMinor: number;
  expenseMinor: number;
  transfersMinor: number;
  receivablesMinor: number;
  payablesMinor: number;
  transactionCount: number;
  note?: string;
  closedAt: Date;
  reopenedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const monthClosingSchema = new Schema<IMonthClosing>(
  {
    ...scopeFields(),
    year: { type: Number, required: true, min: 1970, max: 3000 },
    month: { type: Number, required: true, min: 1, max: 12 },
    openingBalanceMinor: moneyField({ default: 0 }),
    totalReceiptsMinor: moneyField({ default: 0, signed: false }),
    totalPaymentsMinor: moneyField({ default: 0, signed: false }),
    closingBalanceMinor: moneyField({ default: 0 }),
    incomeMinor: moneyField({ default: 0, signed: false }),
    expenseMinor: moneyField({ default: 0, signed: false }),
    transfersMinor: moneyField({ default: 0, signed: false }),
    receivablesMinor: moneyField({ default: 0 }),
    payablesMinor: moneyField({ default: 0 }),
    transactionCount: { type: Number, default: 0, min: 0 },
    note: { type: String, trim: true, maxlength: 500 },
    closedAt: { type: Date, default: () => new Date() },
    reopenedAt: { type: Date, default: null },
  },
  baseOptions,
);

monthClosingSchema.index({ workspaceId: 1, year: 1, month: 1 }, { unique: true });

export const MonthClosing = defineModel<IMonthClosing>('MonthClosing', monthClosingSchema);
