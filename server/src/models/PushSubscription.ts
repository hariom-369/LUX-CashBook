import { Schema, type Types } from 'mongoose';
import { defineModel, baseOptions } from './shared.js';

/**
 * A browser's push endpoint (§41), one per device/browser a user has enabled
 * notifications on. Not workspace-scoped — a device receives a push regardless
 * of which workspace is active when the alert was raised.
 */
export interface IPushSubscription {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: Date;
  updatedAt: Date;
}

const pushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, maxlength: 1000 },
    p256dh: { type: String, required: true, maxlength: 200 },
    auth: { type: String, required: true, maxlength: 200 },
  },
  baseOptions,
);

pushSubscriptionSchema.index({ userId: 1, endpoint: 1 }, { unique: true });

export const PushSubscription = defineModel<IPushSubscription>('PushSubscription', pushSubscriptionSchema);
