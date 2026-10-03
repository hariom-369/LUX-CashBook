import { Schema, type Types } from 'mongoose';
import { defineModel, baseOptions, moneyField, scopeFields, softDeleteFields } from './shared.js';

/**
 * A stocked item (§Phase 12 — basic inventory). `stockQty` is a read cache
 * over `StockMovement` the same way `Account.cachedBalanceMinor` is a cache
 * over postings — the authoritative figure is the sum of every movement,
 * and every write to it goes through `product.service.ts#recordStockMovement`'s
 * atomic `$inc`, never a direct `stockQty` write, so it can never drift from
 * the movement history that justifies it.
 */
export interface IProduct {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  sku: string;
  unitPriceMinor: number;
  costPriceMinor?: number | null;
  /** §Phase 13 — HSN (goods) or SAC (services) code. */
  hsnCode?: string;
  stockQty: number;
  lowStockThreshold: number;
  isActive: boolean;
  notes?: string;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    ...scopeFields(),
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    sku: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    unitPriceMinor: moneyField({ required: true, signed: false }),
    costPriceMinor: moneyField({ signed: false }),
    hsnCode: { type: String, trim: true, maxlength: 10 },
    stockQty: { type: Number, default: 0 },
    lowStockThreshold: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    notes: { type: String, trim: true, maxlength: 2000 },
    ...softDeleteFields,
    rev: { type: Number, default: 0, min: 0 },
  },
  baseOptions,
);

productSchema.index(
  { workspaceId: 1, sku: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
productSchema.index({ workspaceId: 1, name: 1 }, { collation: { locale: 'en', strength: 2 } });

export const Product = defineModel<IProduct>('Product', productSchema);
