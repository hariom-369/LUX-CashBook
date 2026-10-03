import { Schema, type Types } from 'mongoose';
import { defineModel, baseOptions, moneyField, scopeFields } from './shared.js';

/**
 * A physical cash count against a petty cash float (§Phase 12 — "petty
 * cash 2.0"), the same "expected vs counted" idea `DayClosing` already
 * applies to the main cash accounts, scoped here to one imprest float
 * instead. Never adjusts the float itself — a count is a record of what was
 * found, not a transaction; if the custodian wants the books to match the
 * drawer, that's an `adjustment` transaction recorded separately, same as
 * day closing's own `adjustmentTransactionId` pattern.
 */
export interface IPettyCashCount {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  pettyCashId: Types.ObjectId;
  date: Date;
  expectedMinor: number;
  countedMinor: number;
  differenceMinor: number;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const pettyCashCountSchema = new Schema<IPettyCashCount>(
  {
    ...scopeFields(),
    pettyCashId: { type: Schema.Types.ObjectId, ref: 'PettyCash', required: true },
    date: { type: Date, required: true },
    expectedMinor: moneyField({ required: true, signed: false }),
    countedMinor: moneyField({ required: true, signed: false }),
    differenceMinor: moneyField({ required: true, signed: true }),
    note: { type: String, trim: true, maxlength: 500 },
  },
  baseOptions,
);

pettyCashCountSchema.index({ workspaceId: 1, pettyCashId: 1, createdAt: -1 });

export const PettyCashCount = defineModel<IPettyCashCount>('PettyCashCount', pettyCashCountSchema);
