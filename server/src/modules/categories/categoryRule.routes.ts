import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, created, noContent, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { idParamSchema, objectIdSchema, validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as service from './categoryRule.service.js';

/** Category rules (§Phase 2): suggestions only - nothing here ever changes an existing transaction. */
export const categoryRuleRouter: Router = Router();
categoryRuleRouter.use(requireAuth, requireWorkspace);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

const pattern = z.string().trim().toLowerCase().min(2, 'Use at least 2 characters.').max(60);

categoryRuleRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listRules(scopeOf(req)));
  }),
);

categoryRuleRouter.get(
  '/suggest',
  validate({
    query: z.object({
      description: z.string().max(200).optional(),
      payee: z.string().max(80).optional(),
      kind: z.enum(['income', 'expense']).default('expense'),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as unknown as { description?: string; payee?: string; kind: 'income' | 'expense' };
    ok(res, await service.suggestCategory(scopeOf(req), q));
  }),
);

categoryRuleRouter.post(
  '/',
  writeLimiter,
  validate({ body: z.object({ pattern, field: z.enum(['description', 'payee']).optional(), categoryId: objectIdSchema }) }),
  asyncHandler(async (req: Request, res: Response) => {
    created(res, await service.createRule(scopeOf(req), req.body, auditContext(req)));
  }),
);

categoryRuleRouter.patch(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema, body: z.object({ pattern: pattern.optional(), categoryId: objectIdSchema.optional() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.updateRule(scopeOf(req), param(req, 'id'), req.body, auditContext(req)));
  }),
);

categoryRuleRouter.post(
  '/:id/confirm',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.confirmRule(scopeOf(req), param(req, 'id')));
  }),
);

categoryRuleRouter.delete(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteRule(scopeOf(req), param(req, 'id'), auditContext(req));
    noContent(res);
  }),
);
