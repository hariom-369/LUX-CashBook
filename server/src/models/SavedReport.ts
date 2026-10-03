import { Schema, type Types } from 'mongoose';
import { defineModel, baseOptions, scopeFields } from './shared.js';

/**
 * A report-builder definition the user chose to keep (§Phase 7). It stores only the *definition* -
 * the allow-listed filters and grouping - never results, so a saved report always reflects the ledger
 * as it is today. The definition is validated against a strict schema both when it is saved and again
 * every time it is run (`modules/reports/reportBuilder.service.ts`).
 */
export interface ISavedReport {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  definition: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const savedReportSchema = new Schema<ISavedReport>(
  {
    ...scopeFields(),
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    definition: { type: Schema.Types.Mixed, required: true },
  },
  { ...baseOptions, minimize: false },
);

savedReportSchema.index({ workspaceId: 1, name: 1 });

export const SavedReport = defineModel<ISavedReport>('SavedReport', savedReportSchema);
