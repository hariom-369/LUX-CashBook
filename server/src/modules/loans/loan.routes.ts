import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { dateSchema, idParamSchema, positiveAmountSchema, validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as service from './loan.service.js';

export const loanRouter: Router = Router();

loanRouter.use(requireAuth, requireWorkspace);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

loanRouter.get(
  '/:id/installments',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.getInstallmentPlan(scopeOf(req), param(req, 'id')));
  }),
);

const installmentsSchema = z.object({
  installments: z
    .array(z.object({ dueDate: dateSchema, amountMinor: positiveAmountSchema }))
    .min(1, 'Add at least one installment.')
    .max(60, 'Keep an installment schedule under 60 entries.'),
});

loanRouter.put(
  '/:id/installments',
  writeLimiter,
  validate({ params: idParamSchema, body: installmentsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const plan = await service.setInstallmentPlan(scopeOf(req), param(req, 'id'), req.body.installments, auditContext(req));
    ok(res, plan);
  }),
);

loanRouter.delete(
  '/:id/installments',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteInstallmentPlan(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, { deleted: true });
  }),
);
