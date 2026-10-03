import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { WORKSPACE_ROLES } from '@khata/shared';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { objectIdSchema, validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { scopeOf } from '../../middleware/context.js';
import * as members from './member.service.js';
import * as invitations from './invitation.service.js';

/**
 * Member and invitation management for the *active* workspace (§Phase 9) —
 * resolved the same way as every other resource in this API, through
 * `requireWorkspace` and the ambient `X-Workspace-Id` header, not a
 * workspace id in the URL. (A `/workspaces/:id/members` path would need
 * `requireWorkspace` to read `:id` instead of the header — but `:id` means
 * something different on every other route that has one, like an account
 * or transaction id, so this stays consistent with the rest of the API
 * instead of growing a second resolution mechanism.) A non-member gets the
 * same 404 as a nonexistent workspace, and a viewer is already refused any
 * non-GET here by that same middleware.
 */
export const memberRouter: Router = Router();

memberRouter.use(requireAuth, requireWorkspace);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

memberRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await members.listMembers(scopeOf(req)));
  }),
);

memberRouter.patch(
  '/:userId',
  writeLimiter,
  validate({ params: z.object({ userId: objectIdSchema }), body: z.object({ role: z.enum(WORKSPACE_ROLES) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    await members.changeMemberRole(scopeOf(req), req.params.userId as string, req.body.role, auditContext(req));
    ok(res, { updated: true });
  }),
);

memberRouter.delete(
  '/:userId',
  writeLimiter,
  validate({ params: z.object({ userId: objectIdSchema }) }),
  asyncHandler(async (req: Request, res: Response) => {
    await members.removeMember(scopeOf(req), req.params.userId as string, auditContext(req));
    ok(res, { removed: true });
  }),
);

export const invitationManagementRouter: Router = Router();

invitationManagementRouter.use(requireAuth, requireWorkspace);

invitationManagementRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await invitations.listInvitations(scopeOf(req)));
  }),
);

invitationManagementRouter.post(
  '/',
  writeLimiter,
  validate({ body: z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(WORKSPACE_ROLES) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    created(res, await invitations.createInvitation(scopeOf(req), req.body, auditContext(req)));
  }),
);

invitationManagementRouter.delete(
  '/:invitationId',
  writeLimiter,
  validate({ params: z.object({ invitationId: objectIdSchema }) }),
  asyncHandler(async (req: Request, res: Response) => {
    await invitations.revokeInvitation(scopeOf(req), req.params.invitationId as string, auditContext(req));
    ok(res, { revoked: true });
  }),
);
