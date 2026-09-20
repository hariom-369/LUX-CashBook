import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { resolveRange, RANGE_PRESETS } from '@khata/shared';
import { asyncHandler } from '../../lib/http.js';
import { requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { dateSchema, idParamSchema, validate } from '../../middleware/validate.js';
import { reportLimiter } from '../../middleware/rateLimit.js';
import * as service from './pdf.service.js';

export const pdfRouter: Router = Router();

pdfRouter.use(requireAuth, requireWorkspace, reportLimiter);

const rangeQuery = z.object({
  range: z.enum(RANGE_PRESETS).default('this_month'),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

function resolve(query: { range: (typeof RANGE_PRESETS)[number]; from?: Date; to?: Date }) {
  if (query.from && query.to) return { from: query.from, to: query.to };
  return resolveRange(query.range);
}

function sendPdf(res: Response, buffer: Buffer, fileName: string): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', String(buffer.byteLength));
  res.send(buffer);
}

pdfRouter.get(
  '/accounts/:id',
  validate({ params: idParamSchema, query: rangeQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to } = resolve(req.query as unknown as { range: (typeof RANGE_PRESETS)[number]; from?: Date; to?: Date });
    const buffer = await service.generateAccountStatementPdf(scopeOf(req), param(req, 'id'), { from, to });
    sendPdf(res, buffer, `statement-${Date.now()}.pdf`);
  }),
);

pdfRouter.get(
  '/people/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const buffer = await service.generatePersonLedgerPdf(scopeOf(req), param(req, 'id'));
    sendPdf(res, buffer, `ledger-${Date.now()}.pdf`);
  }),
);

pdfRouter.get(
  '/cash-book',
  validate({ query: rangeQuery.extend({ view: z.enum(['single', 'double', 'triple']).default('double') }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as { range: (typeof RANGE_PRESETS)[number]; from?: Date; to?: Date; view: 'single' | 'double' | 'triple' };
    const { from, to } = resolve(query);
    const buffer = await service.generateCashBookPdf(scopeOf(req), query.view, { from, to });
    sendPdf(res, buffer, `cash-book-${Date.now()}.pdf`);
  }),
);
