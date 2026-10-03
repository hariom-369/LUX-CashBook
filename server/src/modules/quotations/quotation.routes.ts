import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PRICE_TYPES, QUOTATION_STATUSES } from '@khata/shared';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { amountMinorSchema, dateSchema, idParamSchema, objectIdSchema, text, validate, revisionField } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as service from './quotation.service.js';
import { toInvoiceDto } from '../invoices/invoice.service.js';

export const quotationRouter: Router = Router();

quotationRouter.use(requireAuth, requireWorkspace);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

const lineItemSchema = z.object({
  description: z.string().trim().min(1, 'Describe this line.').max(200),
  quantity: z.number().positive('Quantity must be greater than zero.').max(1_000_000),
  rateMinor: amountMinorSchema.refine((n) => n >= 0, 'A rate cannot be negative.'),
  hsnCode: text(10),
});

const createSchema = z.object({
  personId: objectIdSchema,
  projectId: objectIdSchema.nullable().optional(),
  issueDate: dateSchema,
  expiryDate: dateSchema,
  items: z.array(lineItemSchema).min(1, 'Add at least one line item.').max(100),
  discountMinor: amountMinorSchema.refine((n) => n >= 0, 'A discount cannot be negative.').optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  priceType: z.enum(PRICE_TYPES).optional(),
  notes: text(2000),
});

const updateSchema = createSchema.partial().extend({ rev: revisionField });

quotationRouter.get(
  '/',
  validate({ query: z.object({ status: z.enum(QUOTATION_STATUSES).optional(), personId: objectIdSchema.optional() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listQuotations(scopeOf(req), req.query as never));
  }),
);

quotationRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const quotation = await service.getQuotation(scopeOf(req), param(req, 'id'));
    ok(res, service.toQuotationDto(quotation));
  }),
);

quotationRouter.post(
  '/',
  writeLimiter,
  validate({ body: createSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const quotation = await service.createQuotation(scopeOf(req), req.body, auditContext(req));
    created(res, service.toQuotationDto(quotation));
  }),
);

quotationRouter.patch(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema, body: updateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { rev, ...changes } = req.body;
    const quotation = await service.updateQuotation(scopeOf(req), param(req, 'id'), changes, auditContext(req), rev);
    ok(res, service.toQuotationDto(quotation));
  }),
);

quotationRouter.post(
  '/:id/status',
  writeLimiter,
  validate({
    params: idParamSchema,
    body: z.object({ status: z.enum(['sent', 'accepted', 'declined', 'expired']) }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const quotation = await service.setQuotationStatus(scopeOf(req), param(req, 'id'), req.body.status, auditContext(req));
    ok(res, service.toQuotationDto(quotation));
  }),
);

quotationRouter.post(
  '/:id/convert',
  writeLimiter,
  validate({ params: idParamSchema, body: z.object({ issueDate: dateSchema.optional(), dueDate: dateSchema }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { invoice, quotation } = await service.convertQuotationToInvoice(scopeOf(req), param(req, 'id'), req.body, auditContext(req));
    created(res, { invoice: toInvoiceDto(invoice), quotation: service.toQuotationDto(quotation) });
  }),
);

quotationRouter.delete(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteQuotation(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, { deleted: true });
  }),
);
