import { Schema, type Types } from 'mongoose';
import { PERSON_RELATIONSHIPS, type PersonRelationship } from '@khata/shared';
import { defineModel, baseOptions, moneyField, scopeFields, softDeleteFields, tagsField } from './shared.js';

/**
 * Someone you lend to or borrow from — a friend, a customer, a supplier.
 *
 * Sign convention (ARCHITECTURE §3.3), used identically everywhere:
 *   balance > 0  →  they owe you   ("You will receive")
 *   balance < 0  →  you owe them   ("You need to pay")
 *
 * As with accounts, `cachedBalanceMinor` is a derived read cache, not the truth.
 * The authoritative figure is `openingBalanceMinor` plus the signed person legs of
 * every live transaction, which `services/ledger.ts` computes.
 */
export interface IPerson {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  phone?: string;
  email?: string;
  avatarUrl?: string;
  relationship: PersonRelationship;
  notes?: string;
  tags: string[];
  /** Balance carried in from before the app was used. Same sign convention. */
  openingBalanceMinor: number;
  openingDate: Date;
  cachedBalanceMinor: number;
  cachedBalanceAt: Date;
  isArchived: boolean;
  lastTransactionAt?: Date | null;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const personSchema = new Schema<IPerson>(
  {
    ...scopeFields(),
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    phone: { type: String, trim: true, maxlength: 24 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    avatarUrl: { type: String, maxlength: 512 },
    relationship: { type: String, enum: PERSON_RELATIONSHIPS, default: 'friend' },
    notes: { type: String, trim: true, maxlength: 1000 },
    tags: tagsField,
    // Signed on purpose: a person can start out owing you or being owed.
    openingBalanceMinor: moneyField({ default: 0 }),
    openingDate: { type: Date, default: () => new Date() },
    cachedBalanceMinor: moneyField({ default: 0 }),
    cachedBalanceAt: { type: Date, default: () => new Date() },
    isArchived: { type: Boolean, default: false },
    lastTransactionAt: { type: Date, default: null },
    ...softDeleteFields,
  },
  baseOptions,
);

personSchema.index(
  { workspaceId: 1, name: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null }, collation: { locale: 'en', strength: 2 } },
);
personSchema.index({ workspaceId: 1, isArchived: 1, name: 1 });
personSchema.index({ workspaceId: 1, cachedBalanceMinor: 1 });
// Backs the global search (§23) across names, phone numbers and notes.
personSchema.index({ workspaceId: 1, name: 'text', phone: 'text', notes: 'text' });

export const Person = defineModel<IPerson>('Person', personSchema);
