import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { GROUP_SPLIT_METHODS } from '@khata/shared';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { dateSchema, idParamSchema, objectIdSchema, positiveAmountSchema, text, validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as service from './group.service.js';

export const groupRouter: Router = Router();

groupRouter.use(requireAuth, requireWorkspace);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

groupRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listGroups(scopeOf(req)));
  }),
);

groupRouter.post(
  '/',
  writeLimiter,
  validate({
    body: z.object({
      name: z.string().trim().min(1, 'Give this group a name.').max(60),
      memberPersonIds: z.array(objectIdSchema).min(1, 'Add at least one member.').max(30),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const group = await service.createGroup(scopeOf(req), req.body, auditContext(req));
    created(res, await service.getGroup(scopeOf(req), String(group._id)));
  }),
);

groupRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.getGroup(scopeOf(req), param(req, 'id')));
  }),
);

groupRouter.delete(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.archiveGroup(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, { archived: true });
  }),
);

groupRouter.get(
  '/:id/balances',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.getGroupBalances(scopeOf(req), param(req, 'id')));
  }),
);

groupRouter.get(
  '/:id/expenses',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listGroupExpenses(scopeOf(req), param(req, 'id')));
  }),
);

const addExpenseSchema = z.object({
  description: text(200),
  date: dateSchema,
  accountId: objectIdSchema,
  categoryId: objectIdSchema.nullable().optional(),
  splitMethod: z.enum(GROUP_SPLIT_METHODS),
  totalAmountMinor: positiveAmountSchema,
  participants: z
    .array(z.object({ personId: objectIdSchema.nullable(), value: z.number().nonnegative().optional() }))
    .min(1, 'Add at least one participant.')
    .max(31),
});

groupRouter.post(
  '/:id/expenses',
  writeLimiter,
  validate({ params: idParamSchema, body: addExpenseSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    const expense = await service.addGroupExpense(scope, param(req, 'id'), req.body, auditContext(req));
    const expenses = await service.listGroupExpenses(scope, param(req, 'id'));
    created(res, expenses.find((e) => e.id === String(expense._id)));
  }),
);

groupRouter.delete(
  '/:id/expenses/:expenseId',
  writeLimiter,
  validate({ params: z.object({ id: objectIdSchema, expenseId: objectIdSchema }) }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteGroupExpense(scopeOf(req), param(req, 'id'), param(req, 'expenseId'), auditContext(req));
    ok(res, { deleted: true });
  }),
);
