import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { CURRENCIES, INDIAN_STATES, WORKSPACE_MODES } from '@khata/shared';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { param, userIdOf } from '../../middleware/context.js';
import { idParamSchema, text, validate } from '../../middleware/validate.js';
import { actorOf } from '../../middleware/auth.js';
import { recordAudit } from '../../services/audit.service.js';
import * as service from './workspace.service.js';
import { createDemoWorkspace } from './demo.service.js';

export const workspaceRouter: Router = Router();

workspaceRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give this workspace a name.').max(60),
  mode: z.enum(WORKSPACE_MODES).default('personal'),
  currency: z
    .string()
    .toUpperCase()
    .refine((c) => c in CURRENCIES, 'That currency is not supported yet.')
    .default('INR'),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  seedCashAccount: z.boolean().default(true),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  currency: z
    .string()
    .toUpperCase()
    .refine((c) => c in CURRENCIES, 'That currency is not supported yet.')
    .optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  businessName: text(120),
  businessAddress: text(400),
  gstin: text(15),
  logoUrl: text(512),
  state: z.enum(INDIAN_STATES).optional(),
});

workspaceRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listWorkspaces(userIdOf(req)));
  }),
);

workspaceRouter.post(
  '/',
  validate({ body: createSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const workspace = await service.createWorkspace(userIdOf(req), req.body);
    await recordAudit(
      { userId: userIdOf(req), workspaceId: workspace._id, ...actorOf(req) },
      {
        action: 'created',
        entityType: 'Workspace',
        entityId: workspace._id,
        summary: `Created ${workspace.mode} workspace "${workspace.name}"`,
      },
    );
    created(res, service.toWorkspaceDto(workspace, 'owner', 1, true));
  }),
);

workspaceRouter.post(
  '/demo',
  asyncHandler(async (req: Request, res: Response) => {
    const workspace = await createDemoWorkspace(userIdOf(req), actorOf(req));
    created(res, service.toWorkspaceDto(workspace, 'owner', 1, false));
  }),
);

workspaceRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { doc, role } = await service.getWorkspace(userIdOf(req), param(req, 'id'));
    const [memberCount, memberships] = await Promise.all([
      service.countMembers(doc._id),
      service.getOwnMembership(userIdOf(req), doc._id),
    ]);
    ok(res, service.toWorkspaceDto(doc, role, memberCount, memberships?.isDefault ?? false));
  }),
);

workspaceRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = userIdOf(req);
    const workspace = await service.updateWorkspace(userId, param(req, 'id'), req.body);
    await recordAudit(
      { userId, workspaceId: workspace._id, ...actorOf(req) },
      {
        action: 'updated',
        entityType: 'Workspace',
        entityId: workspace._id,
        summary: `Updated workspace "${workspace.name}"`,
      },
    );
    const [memberCount, membership] = await Promise.all([
      service.countMembers(workspace._id),
      service.getOwnMembership(userId, workspace._id),
    ]);
    ok(res, service.toWorkspaceDto(workspace, membership?.role ?? 'owner', memberCount, membership?.isDefault ?? false));
  }),
);

workspaceRouter.post(
  '/:id/default',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.setDefaultWorkspace(userIdOf(req), param(req, 'id'));
    ok(res, { isDefault: true });
  }),
);

workspaceRouter.post(
  '/:id/leave',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.leaveWorkspace(userIdOf(req), param(req, 'id'));
    ok(res, { left: true });
  }),
);

workspaceRouter.delete(
  '/:id',
  validate({
    params: idParamSchema,
    body: z.object({ confirmation: z.string().default('') }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = userIdOf(req);
    const { doc: workspace } = await service.getWorkspace(userId, param(req, 'id'));
    await service.deleteWorkspace(userId, param(req, 'id'), req.body.confirmation);
    await recordAudit(
      { userId, workspaceId: null, ...actorOf(req) },
      {
        action: 'deleted',
        entityType: 'Workspace',
        entityId: workspace._id,
        summary: `Deleted workspace "${workspace.name}" and all of its data`,
      },
    );
    ok(res, { deleted: true });
  }),
);
