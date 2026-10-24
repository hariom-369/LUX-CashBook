import { Schema } from 'mongoose';
import { defineModel, baseOptions } from './shared.js';

/**
 * One-off, deployment-wide facts the server records the first time it needs them — keyed
 * by name, written once with an atomic upsert so several processes agree on the value.
 *
 * `trash.launchedAt` (§Trash): when this deployment first ran the Trash purge. Records
 * soft-deleted more than 30 days before that were never shown in Trash, and were deleted
 * under the old "nothing is ever hard-deleted" promise, so the purge leaves them alone.
 */
export interface ISystemMarker {
  key: string;
  at: Date;
}

const systemMarkerSchema = new Schema<ISystemMarker>(
  {
    key: { type: String, required: true, unique: true, maxlength: 100 },
    at: { type: Date, required: true },
  },
  baseOptions,
);

export const SystemMarker = defineModel<ISystemMarker>('SystemMarker', systemMarkerSchema);
