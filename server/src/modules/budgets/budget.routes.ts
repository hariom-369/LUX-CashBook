import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { amountMinorSchema, dateSchema, idParamSchema, objectIdSchema, validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as service from './budget.service.js';

export const budgetRouter: Router = Router();

budgetRouter.use(requireAuth, requireWorkspace);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give this budget a name.').max(60),
  categoryId: objectIdSchema.nullable(),
  amountMinor: amountMinorSchema.refine((n) => n > 0, 'Enter an amount greater than zero.'),
  period: z.enum(['monthly', 'weekly', 'yearly']).default('monthly'),
  startDate: dateSchema.optional(),
  rollover: z.boolean().default(false),
  alertThresholds: z.array(z.number().positive().max(500)).max(6).optional(),
});

const updateSchema = createSchema.partial().extend({ isActive: z.boolean().optional() });

budgetRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listBudgetsWithProgress(scopeOf(req)));
  }),
);

budgetRouter.post(
  '/',
  writeLimiter,
  validate({ body: createSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const budget = await service.createBudget(scopeOf(req), req.body, auditContext(req));
    created(res, service.toBudgetDto(budget));
  }),
);

budgetRouter.patch(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema, body: updateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const budget = await service.updateBudget(scopeOf(req), param(req, 'id'), req.body, auditContext(req));
    ok(res, service.toBudgetDto(budget));
  }),
);

budgetRouter.delete(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteBudget(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, { deleted: true });
  }),
);
