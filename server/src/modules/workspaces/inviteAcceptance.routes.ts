import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../lib/http.js';
import { actorOf, requireAuth } from '../../middleware/auth.js';
import { userIdOf } from '../../middleware/context.js';
import { validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as invitations from './invitation.service.js';

/**
 * Accepting an invitation (§Phase 9) — token-based, so it isn't workspace-
 * scoped like the rest of the API: the token itself says which workspace.
 * Requires sign-in first (not public) since the invited email must already
 * have a Khata account; this is what keeps a token from leaking who the
 * invitation was actually for to an unauthenticated caller.
 */
export const inviteAcceptanceRouter: Router = Router();

inviteAcceptanceRouter.use(requireAuth);

inviteAcceptanceRouter.get(
  '/:token',
  validate({ params: z.object({ token: z.string().min(16).max(128) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await invitations.previewInvitation(req.params.token as string));
  }),
);

inviteAcceptanceRouter.post(
  '/:token/accept',
  writeLimiter,
  validate({ params: z.object({ token: z.string().min(16).max(128) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = userIdOf(req);
    const workspaceId = await invitations.acceptInvitation(userId, req.user!.email, req.params.token as string, {
      userId,
      workspaceId: null,
      ...actorOf(req),
    });
    ok(res, { workspaceId: String(workspaceId) });
  }),
);
