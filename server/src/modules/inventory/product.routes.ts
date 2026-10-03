import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { STOCK_MOVEMENT_TYPES } from '@khata/shared';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireBusinessMode, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { amountMinorSchema, dateSchema, idParamSchema, queryBoolean, text, validate, revisionField } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as service from './product.service.js';

export const productRouter: Router = Router();

productRouter.use(requireAuth, requireWorkspace, requireBusinessMode);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give this product a name.').max(120),
  sku: z.string().trim().min(1, 'Give this product a SKU.').max(40),
  unitPriceMinor: amountMinorSchema.refine((n) => n >= 0, 'Price cannot be negative.'),
  costPriceMinor: amountMinorSchema.refine((n) => n >= 0, 'Cost cannot be negative.').nullable().optional(),
  hsnCode: text(10),
  lowStockThreshold: z.number().int().min(0).optional(),
  notes: text(2000),
});

const updateSchema = createSchema.partial().extend({ isActive: z.boolean().optional(), rev: revisionField });

productRouter.get(
  '/',
  validate({ query: z.object({ lowStockOnly: queryBoolean(false), includeInactive: queryBoolean(false) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listProducts(scopeOf(req), req.query as never));
  }),
);

productRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, service.toProductDto(await service.getProduct(scopeOf(req), param(req, 'id'))));
  }),
);

productRouter.get(
  '/:id/movements',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listStockMovements(scopeOf(req), param(req, 'id')));
  }),
);

productRouter.post(
  '/',
  writeLimiter,
  validate({ body: createSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const product = await service.createProduct(scopeOf(req), req.body, auditContext(req));
    created(res, service.toProductDto(product));
  }),
);

productRouter.post(
  '/:id/movements',
  writeLimiter,
  validate({
    params: idParamSchema,
    body: z.object({ type: z.enum(STOCK_MOVEMENT_TYPES), quantity: z.number().int(), note: text(500), date: dateSchema.optional() }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    created(res, await service.recordStockMovement(scopeOf(req), param(req, 'id'), req.body, auditContext(req)));
  }),
);

productRouter.patch(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema, body: updateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { rev, ...changes } = req.body;
    const product = await service.updateProduct(scopeOf(req), param(req, 'id'), changes, auditContext(req), rev);
    ok(res, service.toProductDto(product));
  }),
);

productRouter.delete(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteProduct(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, { deleted: true });
  }),
);
