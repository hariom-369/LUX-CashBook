import { Schema, type Types } from 'mongoose';
import { WORKSPACE_MODES, type WorkspaceMode } from '@khata/shared';
import { defineModel, baseOptions, currencyField } from './shared.js';

/**
 * A workspace is the hard data boundary (invariant I8).
 *
 * Personal and Business are the same application over two disjoint datasets:
 * accounts, transactions, people, categories, budgets and reports all hang off a
 * workspace, and `mode` decides which navigation and features are offered.
 */
export interface IWorkspace {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  mode: WorkspaceMode;
  currency: string;
  isDefault: boolean;
  /** Demo workspaces are flagged in the UI and can be wiped in one action (§67). */
  isDemo: boolean;
  /** 1–12. April (4) for the Indian financial year. */
  fiscalYearStartMonth: number;
  /** Business only: shown on generated statements and PDF headers. */
  businessName?: string;
  businessAddress?: string;
  gstin?: string;
  logoUrl?: string;
  /** Months closed via §33. Stored as `YYYY-MM` so a lookup is a plain array match. */
  closedMonths: string[];
  createdAt: Date;
  updatedAt: Date;
}

const workspaceSchema = new Schema<IWorkspace>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    mode: { type: String, enum: WORKSPACE_MODES, required: true, default: 'personal' },
    currency: currencyField,
    isDefault: { type: Boolean, default: false },
    isDemo: { type: Boolean, default: false },
    fiscalYearStartMonth: { type: Number, min: 1, max: 12, default: 4 },
    businessName: { type: String, trim: true, maxlength: 120 },
    businessAddress: { type: String, trim: true, maxlength: 400 },
    gstin: { type: String, trim: true, uppercase: true, maxlength: 15 },
    logoUrl: { type: String, maxlength: 512 },
    closedMonths: { type: [String], default: [] },
  },
  baseOptions,
);

// One workspace name per user, so the switcher is never ambiguous.
workspaceSchema.index({ userId: 1, name: 1 }, { unique: true });
workspaceSchema.index({ userId: 1, isDefault: 1 });

export const Workspace = defineModel<IWorkspace>('Workspace', workspaceSchema);
