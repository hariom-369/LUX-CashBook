import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { INVOICE_STATUSES, PRICE_TYPES } from '@khata/shared';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { amountMinorSchema, dateSchema, idParamSchema, objectIdSchema, text, validate, revisionField } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as service from './invoice.service.js';

export const invoiceRouter: Router = Router();

invoiceRouter.use(requireAuth, requireWorkspace);

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
  dueDate: dateSchema,
  items: z.array(lineItemSchema).min(1, 'Add at least one line item.').max(100),
  discountMinor: amountMinorSchema.refine((n) => n >= 0, 'A discount cannot be negative.').optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  priceType: z.enum(PRICE_TYPES).optional(),
  notes: text(2000),
});

const updateSchema = createSchema.partial().extend({ rev: revisionField });

invoiceRouter.get(
  '/',
  validate({
    query: z.object({
      status: z.enum(INVOICE_STATUSES).optional(),
      personId: objectIdSchema.optional(),
      projectId: objectIdSchema.optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listInvoices(scopeOf(req), req.query as never));
  }),
);

invoiceRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const invoice = await service.getInvoice(scopeOf(req), param(req, 'id'));
    ok(res, service.toInvoiceDto(invoice));
  }),
);

invoiceRouter.post(
  '/',
  writeLimiter,
  validate({ body: createSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const invoice = await service.createInvoice(scopeOf(req), req.body, auditContext(req));
    created(res, service.toInvoiceDto(invoice));
  }),
);

invoiceRouter.patch(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema, body: updateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { rev, ...changes } = req.body;
    const invoice = await service.updateInvoice(scopeOf(req), param(req, 'id'), changes, auditContext(req), rev);
    ok(res, service.toInvoiceDto(invoice));
  }),
);

invoiceRouter.post(
  '/:id/send',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const invoice = await service.sendInvoice(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, service.toInvoiceDto(invoice));
  }),
);

invoiceRouter.post(
  '/:id/pay',
  writeLimiter,
  validate({ params: idParamSchema, body: z.object({ accountId: objectIdSchema, date: dateSchema.optional() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const invoice = await service.markInvoicePaid(scopeOf(req), param(req, 'id'), req.body, auditContext(req));
    ok(res, service.toInvoiceDto(invoice));
  }),
);

invoiceRouter.post(
  '/:id/cancel',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const invoice = await service.cancelInvoice(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, service.toInvoiceDto(invoice));
  }),
);

invoiceRouter.delete(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteInvoice(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, { deleted: true });
  }),
);
