import { Schema, type Types } from 'mongoose';
import { INDIAN_STATES, INVOICE_STORED_STATUSES, PRICE_TYPES, type IndianState, type InvoiceStoredStatus, type PriceType } from '@khata/shared';
import { defineModel, baseOptions, moneyField, scopeFields, softDeleteFields } from './shared.js';

export interface ILineItem {
  description: string;
  quantity: number;
  rateMinor: number;
  amountMinor: number;
  /** §Phase 13 — HSN (goods) or SAC (services) code, entered per line. */
  hsnCode?: string;
}

export const lineItemSchema = new Schema<ILineItem>(
  {
    description: { type: String, required: true, trim: true, maxlength: 200 },
    quantity: { type: Number, required: true, min: 0.01, max: 1_000_000 },
    rateMinor: moneyField({ required: true, signed: false }),
    amountMinor: moneyField({ required: true, signed: false }),
    hsnCode: { type: String, trim: true, maxlength: 10 },
  },
  { _id: false },
);

export interface IGstBreakdown {
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
}

export const gstBreakdownSchema = new Schema<IGstBreakdown>(
  {
    cgstMinor: moneyField({ signed: false }),
    sgstMinor: moneyField({ signed: false }),
    igstMinor: moneyField({ signed: false }),
  },
  { _id: false },
);

/**
 * An invoice (§Phase 11). Line items, totals and the issued number are
 * frozen once sent — editing a sent invoice would make the PDF the customer
 * already has disagree with what the app shows, so `invoice.service.ts`
 * only allows full edits while `status === 'draft'`.
 *
 * Paying an invoice posts an ordinary `income` transaction through the same
 * engine every other transaction goes through (`createTransaction`, inside
 * the same `withTransaction` that flips `status` to `paid`) — invoice
 * revenue is never a parallel ledger, it's the same one.
 */
export interface IInvoice {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  number: string;
  status: InvoiceStoredStatus;
  personId: Types.ObjectId;
  projectId?: Types.ObjectId | null;
  issueDate: Date;
  dueDate: Date;
  items: ILineItem[];
  subtotalMinor: number;
  discountMinor: number;
  taxPercent: number;
  taxMinor: number;
  totalMinor: number;
  /** §Phase 13 */
  priceType: PriceType;
  /** The customer's state at the time of the sale, frozen — see `lib/invoiceMath.ts#splitGst`. */
  placeOfSupplyState?: IndianState;
  gst?: IGstBreakdown;
  notes?: string;
  /** Set only once paid — the account the payment was deposited to. */
  accountId?: Types.ObjectId | null;
  paidTransactionId?: Types.ObjectId | null;
  paidAt?: Date | null;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceSchema = new Schema<IInvoice>(
  {
    ...scopeFields(),
    number: { type: String, required: true, trim: true, maxlength: 40 },
    status: { type: String, enum: INVOICE_STORED_STATUSES, default: 'draft' },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    issueDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
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
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    paidTransactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
    paidAt: { type: Date, default: null },
    ...softDeleteFields,
    rev: { type: Number, default: 0, min: 0 },
  },
  baseOptions,
);

invoiceSchema.index({ workspaceId: 1, number: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
invoiceSchema.index({ workspaceId: 1, status: 1, dueDate: 1 });
invoiceSchema.index({ workspaceId: 1, personId: 1 });
invoiceSchema.index({ workspaceId: 1, projectId: 1 });

export const Invoice = defineModel<IInvoice>('Invoice', invoiceSchema);
