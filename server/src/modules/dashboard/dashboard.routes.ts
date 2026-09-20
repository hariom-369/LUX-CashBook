import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { RANGE_PRESETS } from '@khata/shared';
import { asyncHandler, ok } from '../../lib/http.js';
import { requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { scopeOf } from '../../middleware/context.js';
import { dateSchema, validate } from '../../middleware/validate.js';
import { reportLimiter } from '../../middleware/rateLimit.js';
import * as service from './dashboard.service.js';
import { getCashBook, type CashBookView } from '../cashbook/cashbook.service.js';
import { repairBalances, verifyIntegrity } from '../../services/balance.service.js';

export const dashboardRouter: Router = Router();

dashboardRouter.use(requireAuth, requireWorkspace);

dashboardRouter.get(
  '/',
  validate({ query: z.object({ cashFlowRange: z.enum(RANGE_PRESETS).default('last_30_days') }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { cashFlowRange } = req.query as { cashFlowRange: (typeof RANGE_PRESETS)[number] };
    ok(res, await service.getDashboard(scopeOf(req), { cashFlowRange }));
  }),
);

dashboardRouter.get(
  '/cash-flow',
  validate({
    query: z.object({
      range: z.enum(RANGE_PRESETS).default('last_30_days'),
      from: dateSchema.optional(),
      to: dateSchema.optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { range, from, to } = req.query as unknown as {
      range: (typeof RANGE_PRESETS)[number];
      from?: Date;
      to?: Date;
    };
    const custom = from && to ? { from, to } : undefined;
    ok(res, await service.getCashFlow(scopeOf(req), range, new Date(), custom));
  }),
);

dashboardRouter.get(
  '/upcoming',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.getUpcoming(scopeOf(req)));
  }),
);

export const cashBookRouter: Router = Router();
cashBookRouter.use(requireAuth, requireWorkspace);

cashBookRouter.get(
  '/',
  reportLimiter,
  validate({
    query: z.object({
      view: z.enum(['single', 'double', 'triple']).default('double'),
      from: dateSchema,
      to: dateSchema,
      accountIds: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .transform((v) =>
          typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v,
        ),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { view, from, to, accountIds } = req.query as unknown as {
      view: CashBookView;
      from: Date;
      to: Date;
      accountIds?: string[];
    };
    ok(res, await getCashBook(scopeOf(req), { view, from, to, accountIds }));
  }),
);

/**
 * Ledger integrity (§51, §72).
 *
 * Recomputes every cached balance from the underlying postings and reports any
 * disagreement. Exposed to the user because "every balance is traceable to the
 * transactions" is a claim this application makes, and a claim worth making is
 * worth being able to check.
 */
export const integrityRouter: Router = Router();
integrityRouter.use(requireAuth, requireWorkspace);

integrityRouter.get(
  '/',
  reportLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await verifyIntegrity(scopeOf(req)));
  }),
);

integrityRouter.post(
  '/repair',
  reportLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const scope = scopeOf(req);
    const repaired = await repairBalances(scope);
    // Re-verify rather than assuming the repair worked.
    ok(res, { repaired, verification: await verifyIntegrity(scope) });
  }),
);
