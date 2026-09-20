import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireBusinessMode, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { amountMinorSchema, dateSchema, idParamSchema, objectIdSchema, text, validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as service from './pettycash.service.js';

export const pettyCashRouter: Router = Router();

pettyCashRouter.use(requireAuth, requireWorkspace, requireBusinessMode);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

pettyCashRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listPettyCash(scopeOf(req)));
  }),
);

pettyCashRouter.post(
  '/',
  writeLimiter,
  validate({
    body: z.object({
      accountId: objectIdSchema,
      imprestMinor: amountMinorSchema.refine((n) => n > 0, 'Set a float greater than zero.'),
      custodian: text(80),
      replenishFromAccountId: objectIdSchema.optional(),
      lowBalanceThresholdMinor: amountMinorSchema.optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const record = await service.createPettyCash(scopeOf(req), req.body, auditContext(req));
    created(res, service.toPettyCashDto(record));
  }),
);

pettyCashRouter.post(
  '/:id/replenish',
  writeLimiter,
  validate({
    params: idParamSchema,
    body: z.object({ fromAccountId: objectIdSchema.optional(), date: dateSchema.optional(), note: text(200) }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.replenishPettyCash(scopeOf(req), param(req, 'id'), req.body, auditContext(req)));
  }),
);

pettyCashRouter.delete(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deletePettyCash(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, { deleted: true });
  }),
);
