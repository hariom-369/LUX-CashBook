import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../lib/http.js';
import { requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { scopeOf } from '../../middleware/context.js';
import { validate } from '../../middleware/validate.js';
import * as service from './upcoming.service.js';

/** Unified upcoming payments (read-only). See upcoming.service.ts. */
export const upcomingRouter: Router = Router();

upcomingRouter.use(requireAuth, requireWorkspace);

upcomingRouter.get(
  '/',
  validate({
    query: z.object({
      days: z.coerce.number().int().min(1).max(90).default(30),
      paidDays: z.coerce.number().int().min(0).max(31).default(7),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.getUpcomingPayments(scopeOf(req), req.query as unknown as service.UpcomingOptions));
  }),
);
