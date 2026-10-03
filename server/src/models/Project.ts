import { Schema, type Types } from 'mongoose';
import { PROJECT_STATUSES, type ProjectStatus } from '@khata/shared';
import { defineModel, baseOptions, moneyField, scopeFields, softDeleteFields } from './shared.js';

/**
 * A freelance/client project (§Phase 11) — the thing invoices and billable
 * expenses attach to. Profit is never stored here: it's computed from paid
 * invoices and attributed expense transactions at read time
 * (`project.service.ts#getProjectSummary`), the same "derived, never cached
 * as truth" discipline every balance in this app already follows.
 */
export interface IProject {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  /** The client this project is for — a Person, typically `relationship: 'customer'`. */
  personId?: Types.ObjectId | null;
  status: ProjectStatus;
  budgetMinor?: number | null;
  notes?: string;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema<IProject>(
  {
    ...scopeFields(),
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', default: null },
    status: { type: String, enum: PROJECT_STATUSES, default: 'active' },
    budgetMinor: moneyField({ signed: false }),
    notes: { type: String, trim: true, maxlength: 2000 },
    ...softDeleteFields,
    rev: { type: Number, default: 0, min: 0 },
  },
  baseOptions,
);

projectSchema.index(
  { workspaceId: 1, name: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null }, collation: { locale: 'en', strength: 2 } },
);
projectSchema.index({ workspaceId: 1, status: 1 });

export const Project = defineModel<IProject>('Project', projectSchema);
