import { Schema, type Types } from 'mongoose';
import { defineModel, baseOptions, scopeFields, softDeleteFields } from './shared.js';

/**
 * A receipt, bill photo or document attached to a transaction (§26).
 *
 * The file itself lives behind a storage driver (local disk or S3-compatible); this
 * record holds only the metadata and the storage key. Downloads are always served
 * through an authorised endpoint that re-checks workspace ownership — a storage key
 * is never a capability by itself, which is what stops attachment URLs becoming an
 * IDOR hole (§69).
 */
export interface IAttachment {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  transactionId?: Types.ObjectId | null;
  /** Original file name, sanitised. Shown to the user, never used as a path. */
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Opaque key within the active storage driver. */
  storageKey: string;
  storageDriver: 'local' | 's3';
  thumbnailKey?: string | null;
  /** SHA-256 of the file, so re-uploading the same receipt can be recognised. */
  checksum?: string;
  width?: number;
  height?: number;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const attachmentSchema = new Schema<IAttachment>(
  {
    ...scopeFields(),
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
    fileName: { type: String, required: true, maxlength: 200 },
    mimeType: { type: String, required: true, maxlength: 100 },
    sizeBytes: { type: Number, required: true, min: 0 },
    storageKey: { type: String, required: true, maxlength: 400 },
    storageDriver: { type: String, enum: ['local', 's3'], default: 'local' },
    thumbnailKey: { type: String, default: null, maxlength: 400 },
    checksum: { type: String, maxlength: 64 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    ...softDeleteFields,
  },
  baseOptions,
);

attachmentSchema.index({ workspaceId: 1, transactionId: 1, deletedAt: 1 });
attachmentSchema.index({ workspaceId: 1, checksum: 1 }, { sparse: true });

export const Attachment = defineModel<IAttachment>('Attachment', attachmentSchema);
