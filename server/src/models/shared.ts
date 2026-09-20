import mongoose, { Schema, type Model, type Types } from 'mongoose';
import { MAX_AMOUNT_MINOR } from '@khata/shared';

/**
 * Conventions every model in this system follows.
 *
 * Keeping them in one place means a new collection cannot accidentally leak `__v`,
 * expose a raw `_id`, or store a fractional amount.
 */

export type ObjectId = Types.ObjectId;

/**
 * Register a model, reusing an existing registration if there is one.
 *
 * Mongoose keeps a single global model registry, but a test runner (or a dev-server
 * hot reload) can evaluate this module more than once against that same registry,
 * and `mongoose.model()` throws on the second call. Looking the model up first makes
 * registration idempotent without weakening anything at runtime.
 */
export function defineModel<T>(name: string, schema: Schema<T>): Model<T> {
  return (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, schema);
}

/** `_id` → `id`, drop `__v`, drop anything explicitly marked private. */
const transform = (_doc: unknown, ret: Record<string, unknown>) => {
  ret.id = String(ret._id);
  delete ret._id;
  delete ret.__v;
  return ret;
};

// Left unannotated on purpose: Mongoose's `SchemaOptions` is generic over the
// document type, so a single concrete annotation here would be incompatible with
// every schema that spreads it.
export const baseOptions = {
  timestamps: true,
  versionKey: false as const,
  toJSON: { virtuals: true, transform },
  toObject: { virtuals: true, transform },
  // Reject writes containing fields the schema doesn't declare, rather than
  // silently dropping them — a typo in a client payload should be visible.
  strict: 'throw' as const,
};

/**
 * Amount field factory (invariant I1).
 *
 * Every monetary field in every collection is declared through this, so there is
 * exactly one definition of "a valid amount" and no path by which a float, a NaN
 * or an absurd value reaches the database.
 */
export function moneyField(options: { required?: boolean; default?: number; signed?: boolean } = {}) {
  return {
    type: Number,
    required: options.required ?? false,
    default: options.default ?? 0,
    validate: {
      validator(value: number) {
        if (value === null || value === undefined) return !options.required;
        if (!Number.isSafeInteger(value)) return false;
        if (Math.abs(value) > MAX_AMOUNT_MINOR) return false;
        if (options.signed === false && value < 0) return false;
        return true;
      },
      message: '{PATH} must be a whole number of minor currency units within the supported range.',
    },
  };
}

/** A hex colour used for category/account/goal chips. */
export const colorField = {
  type: String,
  default: '#B08D4F',
  validate: {
    validator: (v: string) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v),
    message: 'Colour must be a hex value like #B08D4F.',
  },
};

/** A Lucide icon name. Validated loosely — the client falls back if it can't resolve one. */
export const iconField = {
  type: String,
  default: 'Circle',
  maxlength: 48,
  trim: true,
};

export const currencyField = {
  type: String,
  required: true,
  uppercase: true,
  minlength: 3,
  maxlength: 3,
  default: 'INR',
};

/** Free-form user tags. Normalised to lowercase so filtering is predictable. */
export const tagsField = {
  type: [String],
  default: [] as string[],
  set: (tags: string[]) =>
    Array.isArray(tags)
      ? [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20)
      : [],
};

/**
 * Soft-delete fields (invariant I7).
 *
 * Nothing in a ledger is ever removed: UNDO (§43), the audit trail (§42) and
 * "never lose historical transactions" (§72) all depend on the row still existing.
 */
export const softDeleteFields = {
  deletedAt: { type: Date, default: null, index: true },
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
};

/** Ownership fields. Present on every workspace-scoped collection (invariant I8). */
export function scopeFields() {
  return {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  };
}
