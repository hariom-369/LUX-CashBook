import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireBusinessMode, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { amountMinorSchema, csvObjectIds, dateSchema, idParamSchema, text, validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as service from './closing.service.js';

export const closingRouter: Router = Router();

closingRouter.use(requireAuth, requireWorkspace, requireBusinessMode);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

closingRouter.get(
  '/day/preview',
  validate({ query: z.object({ date: dateSchema, accountIds: csvObjectIds }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { date, accountIds } = req.query as unknown as { date: Date; accountIds?: string[] };
    ok(res, await service.previewDayClosing(scopeOf(req), date, accountIds));
  }),
);

closingRouter.get(
  '/day',
  validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(90).default(30) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { limit } = req.query as unknown as { limit: number };
    ok(res, await service.listDayClosings(scopeOf(req), limit));
  }),
);

closingRouter.post(
  '/day',
  writeLimiter,
  validate({
    body: z.object({
      date: dateSchema,
      actualClosingMinor: amountMinorSchema,
      accountIds: z.array(z.string()).optional(),
      note: text(500),
      postAdjustment: z.boolean().default(false),
      adjustmentAccountId: z.string().optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    created(res, await service.closeDay(scopeOf(req), req.body, auditContext(req)));
  }),
);

closingRouter.post(
  '/day/:id/reopen',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.reopenDay(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, { reopened: true });
  }),
);

closingRouter.get(
  '/month',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listMonthClosings(scopeOf(req)));
  }),
);

closingRouter.post(
  '/month',
  writeLimiter,
  validate({
    body: z.object({
      year: z.number().int().min(1970).max(3000),
      month: z.number().int().min(1).max(12),
      note: text(500),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    created(res, await service.closeMonth(scopeOf(req), req.body.year, req.body.month, req.body.note, auditContext(req)));
  }),
);

closingRouter.post(
  '/month/:id/reopen',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.reopenMonth(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, { reopened: true });
  }),
);
