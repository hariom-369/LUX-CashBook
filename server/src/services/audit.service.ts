import type { Types } from 'mongoose';
import type { AuditAction } from '@khata/shared';
import { AuditLog } from '../models/index.js';
import { logger } from '../lib/logger.js';

export interface AuditContext {
  userId: Types.ObjectId;
  workspaceId?: Types.ObjectId | null;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId: string | Types.ObjectId;
  summary: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * Record an action in the audit trail (§42).
 *
 * Audit writes must never break the operation they describe: if the log insert
 * fails, the transaction the user just saved is still valid and still theirs. So a
 * failure here is logged loudly and swallowed rather than propagated — losing an
 * audit row is bad, but rolling back a saved transaction because of one is worse.
 */
export async function recordAudit(ctx: AuditContext, entry: AuditEntry): Promise<void> {
  try {
    await AuditLog.create({
      userId: ctx.userId,
      workspaceId: ctx.workspaceId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: String(entry.entityId),
      summary: entry.summary.slice(0, 300),
      before: entry.before ?? null,
      after: entry.after ?? null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
  } catch (err) {
    logger.error({ err, entry: { ...entry, before: undefined, after: undefined } }, 'Audit write failed');
  }
}

/**
 * Reduce a document to just the fields that changed, so the audit log stores a
 * diff rather than two copies of everything.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T | null | undefined,
  fields: Array<keyof T>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  if (!before || !after) return null;
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  let changed = false;

  for (const field of fields) {
    const beforeValue = normalize(before[field]);
    const afterValue = normalize(after[field]);
    if (beforeValue !== afterValue) {
      b[String(field)] = before[field];
      a[String(field)] = after[field];
      changed = true;
    }
  }

  return changed ? { before: b, after: a } : null;
}

function normalize(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
