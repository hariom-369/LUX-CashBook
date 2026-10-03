import { Schema, type Types } from 'mongoose';
import { STOCK_MOVEMENT_TYPES, type StockMovementType } from '@khata/shared';
import { defineModel, baseOptions } from './shared.js';

/**
 * A single stock change (§Phase 12). `quantity` is always the signed delta
 * actually applied to the product's `stockQty` — never a magnitude the
 * reader has to re-sign based on `type` — so a movement row and the
 * product's current stock can always be reconciled by summing this field
 * directly.
 */
export interface IStockMovement {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  productId: Types.ObjectId;
  type: StockMovementType;
  quantity: number;
  note?: string;
  date: Date;
  createdAt: Date;
  updatedAt: Date;
}

const stockMovementSchema = new Schema<IStockMovement>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    type: { type: String, enum: STOCK_MOVEMENT_TYPES, required: true },
    quantity: {
      type: Number,
      required: true,
      validate: { validator: (v: number) => Number.isInteger(v) && v !== 0, message: 'Quantity must be a non-zero whole number.' },
    },
    note: { type: String, trim: true, maxlength: 500 },
    date: { type: Date, required: true },
  },
  baseOptions,
);

stockMovementSchema.index({ workspaceId: 1, productId: 1, date: -1 });

export const StockMovement = defineModel<IStockMovement>('StockMovement', stockMovementSchema);
