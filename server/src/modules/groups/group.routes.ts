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

groupRouter.patch(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema, body: z.object({ name: z.string().trim().min(1, 'Give this group a name.').max(60) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.renameGroup(scopeOf(req), param(req, 'id'), req.body.name, auditContext(req));
    ok(res, await service.getGroup(scopeOf(req), param(req, 'id')));
  }),
);

groupRouter.post(
  '/:id/members',
  writeLimiter,
  validate({ params: idParamSchema, body: z.object({ personIds: z.array(objectIdSchema).min(1, 'Add at least one member.').max(30) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.addGroupMembers(scopeOf(req), param(req, 'id'), req.body.personIds, auditContext(req));
    ok(res, await service.getGroup(scopeOf(req), param(req, 'id')));
  }),
);

groupRouter.delete(
  '/:id/members/:personId',
  writeLimiter,
  validate({ params: z.object({ id: objectIdSchema, personId: objectIdSchema }) }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.removeGroupMember(scopeOf(req), param(req, 'id'), param(req, 'personId'), auditContext(req));
    ok(res, await service.getGroup(scopeOf(req), param(req, 'id')));
  }),
);

/** Everyone's paid / share / net, what is still to be settled, and the payments already made. */
groupRouter.get(
  '/:id/summary',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.getGroupSummary(scopeOf(req), param(req, 'id')));
  }),
);

groupRouter.post(
  '/:id/settlements',
  writeLimiter,
  validate({
    params: idParamSchema,
    body: z.object({
      fromPersonId: objectIdSchema.nullable(),
      toPersonId: objectIdSchema.nullable(),
      amountMinor: positiveAmountSchema,
      date: dateSchema,
      accountId: objectIdSchema.nullable().optional(),
      note: text(200).optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    created(res, await service.recordGroupSettlement(scopeOf(req), param(req, 'id'), req.body, auditContext(req)));
  }),
);

groupRouter.delete(
  '/:id/settlements/:settlementId',
  writeLimiter,
  validate({ params: z.object({ id: objectIdSchema, settlementId: objectIdSchema }) }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteGroupSettlement(scopeOf(req), param(req, 'id'), param(req, 'settlementId'), auditContext(req));
    ok(res, { deleted: true });
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
  // Needed when you paid, or when a member paid and you have a share — checked by the service, which knows who paid.
  accountId: objectIdSchema.nullable().optional(),
  categoryId: objectIdSchema.nullable().optional(),
  splitMethod: z.enum(GROUP_SPLIT_METHODS),
  totalAmountMinor: positiveAmountSchema,
  participants: z
    .array(z.object({ personId: objectIdSchema.nullable(), value: z.number().nonnegative().finite().optional() }))
    .min(1, 'Add at least one participant.')
    .max(31),
  // Omitted or null: you paid.
  paidByPersonId: objectIdSchema.nullable().optional(),
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

const expenseParams = z.object({ id: objectIdSchema, expenseId: objectIdSchema });

groupRouter.put(
  '/:id/expenses/:expenseId',
  writeLimiter,
  validate({ params: expenseParams, body: addExpenseSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    const expense = await service.updateGroupExpense(scope, param(req, 'id'), param(req, 'expenseId'), req.body, auditContext(req));
    const expenses = await service.listGroupExpenses(scope, param(req, 'id'));
    ok(res, expenses.find((e) => e.id === String(expense._id)));
  }),
);

groupRouter.delete(
  '/:id/expenses/:expenseId',
  writeLimiter,
  validate({ params: expenseParams }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteGroupExpense(scopeOf(req), param(req, 'id'), param(req, 'expenseId'), auditContext(req));
    ok(res, { deleted: true });
  }),
);
