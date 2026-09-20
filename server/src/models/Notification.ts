import { Schema, type Types } from 'mongoose';
import { NOTIFICATION_TYPES, type NotificationType } from '@khata/shared';
import { defineModel, baseOptions, moneyField } from './shared.js';

/** An entry in the notification centre (§41). */
export interface INotification {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** Null for account-wide notices such as backup status. */
  workspaceId?: Types.ObjectId | null;
  type: NotificationType;
  title: string;
  body: string;
  icon: string;
  /** In-app route to open when tapped. */
  link?: string;
  amountMinor?: number;
  isRead: boolean;
  readAt?: Date | null;
  /** Prevents the same alert firing twice, e.g. `budget:<id>:2026-09:90`. */
  dedupeKey?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 140 },
    body: { type: String, required: true, maxlength: 400 },
    icon: { type: String, default: 'Bell', maxlength: 48 },
    link: { type: String, maxlength: 200 },
    amountMinor: moneyField(),
    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    dedupeKey: { type: String, default: null, maxlength: 160 },
  },
  baseOptions,
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);
// Notifications are transient by nature; keep 90 days of them.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const Notification = defineModel<INotification>('Notification', notificationSchema);
