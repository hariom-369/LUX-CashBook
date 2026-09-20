import { Schema, type HydratedDocument, type Types } from 'mongoose';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_META, type AccountType } from '@khata/shared';
import { defineModel, baseOptions, colorField, currencyField, iconField, moneyField, scopeFields, softDeleteFields } from './shared.js';

/**
 * A wallet, bank account, card or cash drawer.
 *
 * `cachedBalanceMinor` is a *read optimisation only* (invariant I2). The truth is
 * `openingBalanceMinor + Σ postings`, and `services/balance.ts` can rebuild the
 * cache for any account at any time. Nothing in the app is allowed to treat the
 * cached figure as authoritative when correctness matters — it exists so the
 * dashboard doesn't aggregate the entire transaction history on every page load.
 */
export interface IAccount {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  type: AccountType;
  currency: string;
  openingBalanceMinor: number;
  openingDate: Date;
  cachedBalanceMinor: number;
  cachedBalanceAt: Date;
  bankName?: string;
  /** Last four digits only — the full number is never stored. */
  last4?: string;
  color: string;
  icon: string;
  isActive: boolean;
  isLiability: boolean;
  blockNegativeBalance: boolean;
  creditLimitMinor?: number;
  excludeFromTotals: boolean;
  notes?: string;
  sortOrder: number;
  /** Marks the cash drawer used by the petty-cash module (§22). */
  isPettyCash: boolean;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const accountSchema = new Schema<IAccount>(
  {
    ...scopeFields(),
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    type: { type: String, enum: ACCOUNT_TYPES, required: true },
    currency: currencyField,
    openingBalanceMinor: moneyField({ default: 0 }),
    openingDate: { type: Date, default: () => new Date() },
    cachedBalanceMinor: moneyField({ default: 0 }),
    cachedBalanceAt: { type: Date, default: () => new Date() },
    bankName: { type: String, trim: true, maxlength: 80 },
    last4: {
      type: String,
      trim: true,
      maxlength: 4,
      validate: {
        validator: (v: string) => !v || /^\d{4}$/.test(v),
        message: 'Enter the last 4 digits only.',
      },
    },
    color: colorField,
    icon: iconField,
    isActive: { type: Boolean, default: true },
    isLiability: { type: Boolean, default: false },
    blockNegativeBalance: { type: Boolean, default: false },
    creditLimitMinor: moneyField({ signed: false }),
    excludeFromTotals: { type: Boolean, default: false },
    notes: { type: String, trim: true, maxlength: 500 },
    sortOrder: { type: Number, default: 0 },
    isPettyCash: { type: Boolean, default: false },
    ...softDeleteFields,
  },
  baseOptions,
);

// Duplicate account names inside one workspace make the account picker a guessing
// game. Enforced only for live accounts so a deleted name can be reused.
accountSchema.index(
  { workspaceId: 1, name: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
accountSchema.index({ workspaceId: 1, isActive: 1, sortOrder: 1 });
accountSchema.index({ userId: 1, workspaceId: 1, deletedAt: 1 });

/** Credit cards and loans are liabilities by default; the user can override it. */
accountSchema.pre('validate', function (this: HydratedDocument<IAccount>, next) {
  if (this.isNew && this.isModified('type') && !this.isModified('isLiability')) {
    this.isLiability = ACCOUNT_TYPE_META[this.type]?.liability ?? false;
  }
  next();
});

export const Account = defineModel<IAccount>('Account', accountSchema);
