import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import {
  dateSchema,
  idParamSchema,
  objectIdSchema,
  positiveAmountSchema,
  text,
  validate,
} from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as service from './goal.service.js';

export const goalRouter: Router = Router();

goalRouter.use(requireAuth, requireWorkspace);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Choose a valid colour.');

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give this goal a name.').max(60),
  targetMinor: positiveAmountSchema,
  targetDate: dateSchema.nullable().optional(),
  icon: text(48),
  color: hexColor.optional(),
  linkedAccountId: objectIdSchema.nullable().optional(),
  notes: text(1000),
});

const updateSchema = createSchema.partial().extend({ isArchived: z.boolean().optional() });

goalRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listGoals(scopeOf(req)));
  }),
);

goalRouter.post(
  '/',
  writeLimiter,
  validate({ body: createSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const goal = await service.createGoal(scopeOf(req), req.body, auditContext(req));
    created(res, service.toGoalDto(goal));
  }),
);

goalRouter.patch(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema, body: updateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const goal = await service.updateGoal(scopeOf(req), param(req, 'id'), req.body, auditContext(req));
    ok(res, service.toGoalDto(goal));
  }),
);

goalRouter.delete(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteGoal(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, { deleted: true });
  }),
);

goalRouter.post(
  '/:id/contributions',
  writeLimiter,
  validate({
    params: idParamSchema,
    body: z.object({ amountMinor: positiveAmountSchema, date: dateSchema.optional(), note: text(200) }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    const goal = await service.addContribution(scope, param(req, 'id'), req.body, auditContext(req));
    created(res, service.toGoalDto(goal));
  }),
);

goalRouter.delete(
  '/:id/contributions/:contributionId',
  writeLimiter,
  validate({ params: z.object({ id: objectIdSchema, contributionId: objectIdSchema }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const goal = await service.removeContribution(
      scopeOf(req),
      param(req, 'id'),
      param(req, 'contributionId'),
      auditContext(req),
    );
    ok(res, service.toGoalDto(goal));
  }),
);
