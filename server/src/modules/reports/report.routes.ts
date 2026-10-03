import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { resolveRange, RANGE_PRESETS } from '@khata/shared';
import { asyncHandler, ok } from '../../lib/http.js';
import { requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { dateSchema, idParamSchema, validate } from '../../middleware/validate.js';
import { reportLimiter } from '../../middleware/rateLimit.js';
import * as service from './report.service.js';
import * as builder from './reportBuilder.service.js';
import { getPersonLedger } from '../people/person.service.js';

export const reportRouter: Router = Router();

reportRouter.use(requireAuth, requireWorkspace, reportLimiter);

const rangeQuery = z.object({
  range: z.enum(RANGE_PRESETS).default('this_month'),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

function resolve(query: { range: (typeof RANGE_PRESETS)[number]; from?: Date; to?: Date }) {
  if (query.from && query.to) return { from: query.from, to: query.to };
  return resolveRange(query.range);
}

reportRouter.get(
  '/category',
  validate({ query: rangeQuery.extend({ kind: z.enum(['income', 'expense']).default('expense') }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as { range: (typeof RANGE_PRESETS)[number]; from?: Date; to?: Date; kind: 'income' | 'expense' };
    const { from, to } = resolve(query);
    ok(res, await service.getCategoryReport(scopeOf(req), { from, to, kind: query.kind }));
  }),
);

reportRouter.get(
  '/net-worth',
  validate({ query: z.object({ months: z.coerce.number().int().min(1).max(36).default(6) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { months } = req.query as unknown as { months: number };
    ok(res, await service.getNetWorth(scopeOf(req), months));
  }),
);

reportRouter.get(
  '/monthly-comparison',
  validate({ query: z.object({ months: z.coerce.number().int().min(1).max(36).default(12) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { months } = req.query as unknown as { months: number };
    ok(res, await service.getMonthlyComparison(scopeOf(req), months));
  }),
);

reportRouter.get(
  '/borrow-lend',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.getBorrowLendReport(scopeOf(req)));
  }),
);

reportRouter.get(
  '/statement',
  validate({ query: rangeQuery.extend({ kind: z.enum(['income', 'expense']).default('expense') }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as { range: (typeof RANGE_PRESETS)[number]; from?: Date; to?: Date; kind: 'income' | 'expense' };
    const { from, to } = resolve(query);
    ok(res, await service.getIncomeExpenseStatement(scopeOf(req), query.kind, from, to));
  }),
);

reportRouter.get(
  '/accounts',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.getAccountSummary(scopeOf(req)));
  }),
);

reportRouter.get(
  '/profit-and-loss',
  validate({ query: rangeQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to } = resolve(req.query as unknown as { range: (typeof RANGE_PRESETS)[number]; from?: Date; to?: Date });
    ok(res, await service.getProfitAndLoss(scopeOf(req), from, to));
  }),
);

reportRouter.get(
  '/ageing',
  validate({ query: z.object({ direction: z.enum(['receivable', 'payable']).default('receivable') }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { direction } = req.query as unknown as { direction: 'receivable' | 'payable' };
    ok(res, await service.getAgeingReport(scopeOf(req), direction));
  }),
);

reportRouter.get(
  '/gst-summary',
  validate({ query: rangeQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to } = resolve(req.query as unknown as { range: (typeof RANGE_PRESETS)[number]; from?: Date; to?: Date });
    ok(res, await service.getGstSummary(scopeOf(req), from, to));
  }),
);

/** A shareable, privacy-conscious snapshot of one person's ledger for §36. */
reportRouter.get(
  '/person/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await getPersonLedger(scopeOf(req), param(req, 'id')));
  }),
);

/** Run a report-builder definition (§Phase 7). A POST because the definition is a structured body, not because it writes anything. */
reportRouter.post(
  '/custom',
  validate({ body: z.object({ definition: z.unknown() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await builder.runReport(scopeOf(req), req.body.definition));
  }),
);

reportRouter.post(
  '/custom/export',
  validate({ body: z.object({ definition: z.unknown() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const csv = builder.resultToCsv(await builder.runReport(scopeOf(req), req.body.definition));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="report-${Date.now()}.csv"`);
    res.send(csv);
  }),
);
