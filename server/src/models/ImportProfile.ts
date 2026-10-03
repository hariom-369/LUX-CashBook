import { Schema, type Types } from 'mongoose';
import { IMPORT_DATE_FORMATS, type ImportColumnMapping, type ImportDateFormat } from '@khata/shared';
import { defineModel, baseOptions, scopeFields } from './shared.js';

/**
 * A saved column mapping for one bank's statement export (§Phase 5, D-3) —
 * so re-importing next month's statement from the same bank never asks the
 * user to map columns again.
 */
export interface IImportProfile {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  dateFormat: ImportDateFormat;
  mapping: ImportColumnMapping;
  defaultAccountId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const mappingSchema = new Schema<ImportColumnMapping>(
  {
    date: { type: String, required: true },
    description: { type: String, required: true },
    amount: { type: String },
    debit: { type: String },
    credit: { type: String },
    reference: { type: String },
  },
  { _id: false },
);

const importProfileSchema = new Schema<IImportProfile>(
  {
    ...scopeFields(),
    name: { type: String, required: true, trim: true, maxlength: 60 },
    dateFormat: { type: String, enum: IMPORT_DATE_FORMATS, required: true },
    mapping: { type: mappingSchema, required: true },
    defaultAccountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
  },
  baseOptions,
);

importProfileSchema.index({ workspaceId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export const ImportProfile = defineModel<IImportProfile>('ImportProfile', importProfileSchema);
