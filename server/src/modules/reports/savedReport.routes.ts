import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, created, noContent, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { idParamSchema, validate } from '../../middleware/validate.js';
import { reportLimiter, writeLimiter } from '../../middleware/rateLimit.js';
import * as builder from './reportBuilder.service.js';

/** Saved report-builder definitions (§Phase 7). Only the definition is stored; results are always computed fresh. */
export const savedReportRouter: Router = Router();
savedReportRouter.use(requireAuth, requireWorkspace);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};
const name = z.string().trim().min(1, 'Give this report a name.').max(80);

savedReportRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await builder.listSaved(scopeOf(req)));
  }),
);

savedReportRouter.post(
  '/',
  writeLimiter,
  validate({ body: z.object({ name, definition: z.unknown() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    created(res, await builder.saveReport(scopeOf(req), req.body.name, req.body.definition, auditContext(req)));
  }),
);

savedReportRouter.patch(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema, body: z.object({ name: name.optional(), definition: z.unknown().optional() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await builder.updateSaved(scopeOf(req), param(req, 'id'), req.body, auditContext(req)));
  }),
);

savedReportRouter.post(
  '/:id/duplicate',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    created(res, await builder.duplicateSaved(scopeOf(req), param(req, 'id'), auditContext(req)));
  }),
);

savedReportRouter.get(
  '/:id/run',
  reportLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await builder.runSaved(scopeOf(req), param(req, 'id')));
  }),
);

savedReportRouter.delete(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await builder.deleteSaved(scopeOf(req), param(req, 'id'), auditContext(req));
    noContent(res);
  }),
);
