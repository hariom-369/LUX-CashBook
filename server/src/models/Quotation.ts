import { Schema, type Types } from 'mongoose';
import { INDIAN_STATES, PRICE_TYPES, QUOTATION_STATUSES, type IndianState, type PriceType, type QuotationStatus } from '@khata/shared';
import { defineModel, baseOptions, moneyField, scopeFields, softDeleteFields } from './shared.js';
import { lineItemSchema, gstBreakdownSchema, type ILineItem, type IGstBreakdown } from './Invoice.js';

/**
 * A quotation (§Phase 11) — the same shape as an invoice, before it's one.
 * `convertToInvoice` (`quotation.service.ts`) copies its items/totals into a
 * brand-new `Invoice` with its own issued number, rather than mutating this
 * document in place, so the quotation stays exactly what the customer saw
 * when they accepted it.
 */
export interface IQuotation {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  number: string;
  status: QuotationStatus;
  personId: Types.ObjectId;
  projectId?: Types.ObjectId | null;
  issueDate: Date;
  expiryDate: Date;
  items: ILineItem[];
  subtotalMinor: number;
  discountMinor: number;
  taxPercent: number;
  taxMinor: number;
  totalMinor: number;
  priceType: PriceType;
  placeOfSupplyState?: IndianState;
  gst?: IGstBreakdown;
  notes?: string;
  convertedInvoiceId?: Types.ObjectId | null;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const quotationSchema = new Schema<IQuotation>(
  {
    ...scopeFields(),
    number: { type: String, required: true, trim: true, maxlength: 40 },
    status: { type: String, enum: QUOTATION_STATUSES, default: 'draft' },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    issueDate: { type: Date, required: true },
    expiryDate: { type: Date, required: true },
    items: { type: [lineItemSchema], validate: (v: ILineItem[]) => v.length > 0 && v.length <= 100 },
    subtotalMinor: moneyField({ required: true, signed: false }),
    discountMinor: moneyField({ signed: false }),
    taxPercent: { type: Number, default: 0, min: 0, max: 100 },
    taxMinor: moneyField({ signed: false }),
    totalMinor: moneyField({ required: true, signed: false }),
    priceType: { type: String, enum: PRICE_TYPES, default: 'exclusive' },
    placeOfSupplyState: { type: String, enum: INDIAN_STATES },
    gst: { type: gstBreakdownSchema, default: undefined },
    notes: { type: String, trim: true, maxlength: 2000 },
    convertedInvoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null },
    ...softDeleteFields,
    rev: { type: Number, default: 0, min: 0 },
  },
  baseOptions,
);

quotationSchema.index({ workspaceId: 1, number: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
quotationSchema.index({ workspaceId: 1, status: 1 });
quotationSchema.index({ workspaceId: 1, personId: 1 });

export const Quotation = defineModel<IQuotation>('Quotation', quotationSchema);
