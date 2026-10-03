import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../lib/http.js';
import { requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { scopeOf } from '../../middleware/context.js';
import { validate } from '../../middleware/validate.js';
import { reportLimiter } from '../../middleware/rateLimit.js';
import * as service from './forecast.service.js';

export const forecastRouter: Router = Router();

forecastRouter.use(requireAuth, requireWorkspace, reportLimiter);

forecastRouter.get(
  '/',
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { days } = req.query as unknown as { days: number };
    ok(res, await service.getForecast(scopeOf(req), days));
  }),
);
