import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AuditLogDto } from '@khata/shared';
import { AuditLog } from '../../models/index.js';
import { asyncHandler, ok, paginate } from '../../lib/http.js';
import { requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { scopeOf } from '../../middleware/context.js';
import { validate } from '../../middleware/validate.js';
import { reportLimiter } from '../../middleware/rateLimit.js';

/** The user-facing audit trail (§42) — what changed, when, and by what action. */
export const auditRouter: Router = Router();

auditRouter.use(requireAuth, requireWorkspace, reportLimiter);

auditRouter.get(
  '/',
  validate({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      entityType: z.string().max(40).optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    const { page, limit, entityType } = req.query as unknown as { page: number; limit: number; entityType?: string };

    const filter: Record<string, unknown> = { workspaceId: scope.workspaceId };
    if (entityType) filter.entityType = entityType;

    const [rows, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);

    const items: AuditLogDto[] = rows.map((row) => ({
      id: String(row._id),
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      summary: row.summary,
      before: row.before ?? undefined,
      after: row.after ?? undefined,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt.toISOString(),
    }));

    ok(res, paginate(items, total, page, limit));
  }),
);
