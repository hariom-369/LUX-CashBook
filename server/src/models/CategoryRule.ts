import { Schema, type Types } from 'mongoose';
import { defineModel, baseOptions, scopeFields } from './shared.js';

/**
 * "If the description (or payee) contains *Jio*, suggest Telecom" (§Phase 2 category rules).
 *
 * A rule is only ever a *suggestion* source: it never recategorises history and never sets a
 * category on its own - the entry form shows the suggestion and the user accepts, corrects or
 * ignores it. `hits` counts how many times a suggestion from this rule was accepted, which is
 * what the confidence cue is built from.
 */
export interface ICategoryRule {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  /** Lowercase text to look for - matched with a plain substring test, never compiled into a pattern. */
  pattern: string;
  field: 'description' | 'payee';
  categoryId: Types.ObjectId;
  kind: 'income' | 'expense';
  hits: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const categoryRuleSchema = new Schema<ICategoryRule>(
  {
    ...scopeFields(),
    pattern: { type: String, required: true, trim: true, lowercase: true, minlength: 2, maxlength: 60 },
    field: { type: String, enum: ['description', 'payee'], default: 'description' },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    kind: { type: String, enum: ['income', 'expense'], required: true },
    hits: { type: Number, default: 0, min: 0 },
    lastUsedAt: { type: Date, default: null },
  },
  baseOptions,
);

categoryRuleSchema.index({ workspaceId: 1, field: 1, pattern: 1 }, { unique: true });

export const CategoryRule = defineModel<ICategoryRule>('CategoryRule', categoryRuleSchema);
