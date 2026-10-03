import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PROJECT_STATUSES } from '@khata/shared';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { amountMinorSchema, idParamSchema, objectIdSchema, text, validate, revisionField } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as service from './project.service.js';

export const projectRouter: Router = Router();

projectRouter.use(requireAuth, requireWorkspace);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give this project a name.').max(120),
  personId: objectIdSchema.nullable().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  budgetMinor: amountMinorSchema.refine((n) => n >= 0, 'A budget cannot be negative.').nullable().optional(),
  notes: text(2000),
});

const updateSchema = createSchema.partial().extend({ rev: revisionField });

projectRouter.get(
  '/',
  validate({ query: z.object({ status: z.enum(PROJECT_STATUSES).optional() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listProjects(scopeOf(req), req.query as { status?: (typeof PROJECT_STATUSES)[number] }));
  }),
);

projectRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const project = await service.getProject(scopeOf(req), param(req, 'id'));
    ok(res, service.toProjectDto(project));
  }),
);

projectRouter.get(
  '/:id/summary',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.getProjectSummary(scopeOf(req), param(req, 'id')));
  }),
);

projectRouter.post(
  '/',
  writeLimiter,
  validate({ body: createSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const project = await service.createProject(scopeOf(req), req.body, auditContext(req));
    created(res, service.toProjectDto(project));
  }),
);

projectRouter.patch(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema, body: updateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { rev, ...changes } = req.body;
    const project = await service.updateProject(scopeOf(req), param(req, 'id'), changes, auditContext(req), rev);
    ok(res, service.toProjectDto(project));
  }),
);

projectRouter.delete(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteProject(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, { deleted: true });
  }),
);
