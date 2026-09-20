import { Schema, type Types } from 'mongoose';
import { defineModel, baseOptions, moneyField, scopeFields } from './shared.js';

/**
 * Imprest petty cash (§22).
 *
 * Under the imprest system the float is a fixed amount: you spend from it, and at
 * replenishment you put back exactly what was spent, returning the drawer to the
 * imprest figure. So there is no separate "petty cash balance" to maintain — the
 * drawer *is* a regular cash account, and this record only adds the imprest policy
 * on top of it. Spend and replenishment are ordinary transactions on that account,
 * which keeps petty cash inside the same ledger as everything else.
 */
export interface IPettyCash {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  /** The cash account that holds the float. */
  accountId: Types.ObjectId;
  imprestMinor: number;
  custodian?: string;
  /** The account replenishments are drawn from, usually the main bank account. */
  replenishFromAccountId?: Types.ObjectId | null;
  lastReplenishedAt?: Date | null;
  /** Warn when the float drops below this. */
  lowBalanceThresholdMinor: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const pettyCashSchema = new Schema<IPettyCash>(
  {
    ...scopeFields(),
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    imprestMinor: moneyField({ required: true, signed: false }),
    custodian: { type: String, trim: true, maxlength: 80 },
    replenishFromAccountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    lastReplenishedAt: { type: Date, default: null },
    lowBalanceThresholdMinor: moneyField({ default: 0, signed: false }),
    isActive: { type: Boolean, default: true },
  },
  baseOptions,
);

pettyCashSchema.index({ workspaceId: 1, accountId: 1 }, { unique: true });

export const PettyCash = defineModel<IPettyCash>('PettyCash', pettyCashSchema);
