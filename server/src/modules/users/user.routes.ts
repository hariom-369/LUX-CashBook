import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { param, userIdOf } from '../../middleware/context.js';
import { validate } from '../../middleware/validate.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import * as service from './user.service.js';
import {
  completeOnboardingSchema,
  deleteAccountSchema,
  setActiveWorkspaceSchema,
  updatePreferencesSchema,
  updateProfileSchema,
} from './user.schema.js';

export const userRouter: Router = Router();

userRouter.use(requireAuth);

userRouter.get(
  '/me',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.getProfile(userIdOf(req)));
  }),
);

userRouter.patch(
  '/me',
  validate({ body: updateProfileSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.updateProfile(userIdOf(req), req.body));
  }),
);

userRouter.patch(
  '/me/preferences',
  validate({ body: updatePreferencesSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.updatePreferences(userIdOf(req), req.body));
  }),
);

userRouter.post(
  '/me/active-workspace',
  validate({ body: setActiveWorkspaceSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.setActiveWorkspace(userIdOf(req), req.body.workspaceId);
    ok(res, { activeWorkspaceId: req.body.workspaceId });
  }),
);

userRouter.post(
  '/me/onboarding/complete',
  validate({ body: completeOnboardingSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.completeOnboarding(userIdOf(req), req.body.activeWorkspaceId));
  }),
);

userRouter.get(
  '/me/sessions',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listSessions(userIdOf(req), req.sessionId));
  }),
);

userRouter.delete(
  '/me/sessions/:familyId',
  validate({ params: z.object({ familyId: z.string().min(8).max(64) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.revokeSession(userIdOf(req), param(req, 'familyId'), req.sessionId);
    ok(res, { revoked: true });
  }),
);

userRouter.post(
  '/me/delete',
  authLimiter,
  validate({ body: deleteAccountSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteAccount(userIdOf(req), req.body.password);
    res.clearCookie('khata_rt', { path: '/api/v1/auth' });
    ok(res, { deleted: true });
  }),
);
