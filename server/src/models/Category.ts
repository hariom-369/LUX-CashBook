import { Schema, type HydratedDocument, type Types } from 'mongoose';
import { CATEGORY_KINDS, type CategoryKind } from '@khata/shared';
import { defineModel, baseOptions, colorField, iconField, scopeFields } from './shared.js';

/**
 * Categories and subcategories are one collection with a self-reference:
 * `parentId === null` is a category, otherwise it is a subcategory of that parent.
 * Two levels is the documented maximum — deeper trees make reports unreadable and
 * the aggregation pipelines recursive for no user benefit.
 */
export interface ICategory {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
  parentId: Types.ObjectId | null;
  /** Seeded defaults. They can be archived and renamed but not deleted outright. */
  isSystem: boolean;
  isArchived: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<ICategory>(
  {
    ...scopeFields(),
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 50 },
    kind: { type: String, enum: CATEGORY_KINDS, required: true },
    icon: iconField,
    color: colorField,
    parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    isSystem: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  baseOptions,
);

categorySchema.index({ workspaceId: 1, kind: 1, parentId: 1, sortOrder: 1 });
categorySchema.index(
  { workspaceId: 1, parentId: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);

/** Reject three-level nesting at write time rather than discovering it in a report. */
categorySchema.pre('save', async function (this: HydratedDocument<ICategory>, next) {
  if (!this.parentId) return next();
  const parent = await Category.findById(this.parentId).lean();
  if (!parent) return next(new Error('Parent category not found.'));
  if (parent.parentId) return next(new Error('Subcategories cannot have their own subcategories.'));
  if (parent.kind !== this.kind) return next(new Error('A subcategory must match its parent kind.'));
  next();
});

export const Category = defineModel<ICategory>('Category', categorySchema);
