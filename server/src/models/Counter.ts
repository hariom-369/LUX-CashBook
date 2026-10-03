import { Schema, type Types } from 'mongoose';
import { defineModel, baseOptions } from './shared.js';

/**
 * Sequential document numbers (§Phase 11) — invoices and quotations need a
 * human-facing number (`INV-2026-00001`) that never skips or collides, even
 * under concurrent writes. One counter per `{workspace, docType, year}`,
 * bumped with a single atomic `$inc` (the same primitive `lib/revision.ts`
 * uses for `rev`), so two requests racing to create the first invoice of
 * the year can never both receive number 1.
 */
export interface ICounter {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  docType: 'invoice' | 'quotation';
  year: number;
  seq: number;
}

const counterSchema = new Schema<ICounter>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    docType: { type: String, enum: ['invoice', 'quotation'], required: true },
    year: { type: Number, required: true },
    seq: { type: Number, default: 0 },
  },
  baseOptions,
);

counterSchema.index({ workspaceId: 1, docType: 1, year: 1 }, { unique: true });

export const Counter = defineModel<ICounter>('Counter', counterSchema);
