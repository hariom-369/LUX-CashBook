import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { TRASH_ITEM_TYPES, TRASH_RETENTION_DAYS } from '@khata/shared';
import { asyncHandler, ok, paginate } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { objectIdSchema, validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as service from './trash.service.js';

/** Trash / Recently Deleted (§Trash). See trash.service.ts for the rules. */
export const trashRouter: Router = Router();

trashRouter.use(requireAuth, requireWorkspace);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

const typeSchema = z.enum(TRASH_ITEM_TYPES);
const itemParams = z.object({ type: typeSchema, id: objectIdSchema });
/** Permanent deletion is never implied: the request has to say so. */
const confirmBody = z.object({ confirm: z.literal(true, { errorMap: () => ({ message: 'Confirm that this should be permanently deleted.' }) }) });

trashRouter.get(
  '/',
  validate({
    query: z.object({
      type: typeSchema.optional(),
      q: z.string().trim().max(100).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as service.TrashListOptions;
    const result = await service.listTrash(scopeOf(req), query);
    ok(res, paginate(result.items, result.total, query.page, query.limit), { retentionDays: TRASH_RETENTION_DAYS });
  }),
);

trashRouter.post(
  '/restore',
  writeLimiter,
  validate({ body: z.object({ items: z.array(z.object({ type: typeSchema, id: objectIdSchema })).min(1).max(100) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.restoreTrashItems(scopeOf(req), req.body.items, auditContext(req)));
  }),
);

trashRouter.post(
  '/empty',
  writeLimiter,
  validate({ body: confirmBody }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.emptyTrash(scopeOf(req)));
  }),
);

trashRouter.post(
  '/:type/:id/restore',
  writeLimiter,
  validate({ params: itemParams }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.restoreTrashItem(scopeOf(req), param(req, 'type') as never, param(req, 'id'), auditContext(req));
    ok(res, { restored: true });
  }),
);

trashRouter.delete(
  '/:type/:id',
  writeLimiter,
  validate({ params: itemParams, body: confirmBody }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteTrashItem(scopeOf(req), param(req, 'type') as never, param(req, 'id'));
    ok(res, { deleted: true });
  }),
);
