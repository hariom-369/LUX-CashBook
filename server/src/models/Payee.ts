import { Schema, type Types } from 'mongoose';
import { defineModel, baseOptions, scopeFields, tagsField } from './shared.js';

/**
 * A merchant or counterparty — "Jio", "Swiggy", "Landlord" — separate from
 * `Person` (docs/PRODUCT_AUDIT.md, finding D-5 / FEATURE_ROADMAP.md decision 3).
 *
 * Kept deliberately apart from `Person`: a `Person` carries a lending balance
 * (invariant-bearing, §3.3), and a merchant has none — folding them into one
 * model would either give every merchant a meaningless balance or weaken the
 * person-ledger invariants to accommodate one that shouldn't have one.
 *
 * `defaultAccountId`/`defaultCategoryId` are conveniences a transaction-entry
 * screen may use to prefill a new entry — never enforced or auto-applied to an
 * existing transaction.
 */
export interface IPayee {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  defaultAccountId: Types.ObjectId | null;
  defaultCategoryId: Types.ObjectId | null;
  notes?: string;
  tags: string[];
  isArchived: boolean;
  /** Set whenever a transaction records this payee — powers "recently used" sorting. */
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const payeeSchema = new Schema<IPayee>(
  {
    ...scopeFields(),
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    defaultAccountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    defaultCategoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    notes: { type: String, trim: true, maxlength: 500 },
    tags: tagsField,
    isArchived: { type: Boolean, default: false },
    lastUsedAt: { type: Date, default: null },
  },
  baseOptions,
);

payeeSchema.index({ workspaceId: 1, isArchived: 1, name: 1 });
// Case-insensitive uniqueness so "Jio" and "jio" can't both be created by accident.
payeeSchema.index(
  { workspaceId: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);
payeeSchema.index({ workspaceId: 1, name: 'text' });

export const Payee = defineModel<IPayee>('Payee', payeeSchema);
