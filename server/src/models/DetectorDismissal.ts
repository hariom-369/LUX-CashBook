import { Schema, type Types } from 'mongoose';
import { defineModel, baseOptions, scopeFields } from './shared.js';

/**
 * Records that a user chose "Ignore" on a subscription-detector suggestion
 * (§21/Phase 3), keyed by the pattern's `signature` (see detector.service.ts).
 * Without this, the same repeating-payment pattern would be re-suggested on
 * every visit to the Bills centre until the user creates a bill for it.
 */
export interface IDetectorDismissal {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  signature: string;
  createdAt: Date;
  updatedAt: Date;
}

const detectorDismissalSchema = new Schema<IDetectorDismissal>(
  {
    ...scopeFields(),
    signature: { type: String, required: true, maxlength: 200 },
  },
  baseOptions,
);

detectorDismissalSchema.index({ workspaceId: 1, signature: 1 }, { unique: true });

export const DetectorDismissal = defineModel<IDetectorDismissal>('DetectorDismissal', detectorDismissalSchema);
