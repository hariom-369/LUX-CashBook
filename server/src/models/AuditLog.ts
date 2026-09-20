import { Schema, type Types } from 'mongoose';
import { AUDIT_ACTIONS, type AuditAction } from '@khata/shared';
import { defineModel, baseOptions } from './shared.js';

/**
 * Append-only record of every meaningful change (§42).
 *
 * This is the answer to "why does my balance look different from yesterday?". It is
 * written on the same request that performs the change, and nothing in the
 * application ever updates or deletes a row here — the model exposes no update path
 * and the service layer only ever inserts.
 */
export interface IAuditLog {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId?: Types.ObjectId | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  /** One-line human summary, e.g. "Deleted expense ₹1,250 · Food". */
  summary: string;
  /** Snapshots of the changed fields only — never the whole document. */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    entityType: { type: String, required: true, maxlength: 40 },
    entityId: { type: String, required: true, maxlength: 40 },
    summary: { type: String, required: true, maxlength: 300 },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    ipAddress: { type: String, maxlength: 64 },
    userAgent: { type: String, maxlength: 256 },
    requestId: { type: String, maxlength: 64 },
  },
  { ...baseOptions, strict: true },
);

auditLogSchema.index({ workspaceId: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ userId: 1, action: 1, createdAt: -1 });

export const AuditLog = defineModel<IAuditLog>('AuditLog', auditLogSchema);
