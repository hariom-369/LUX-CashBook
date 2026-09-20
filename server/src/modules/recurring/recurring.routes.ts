import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PAYMENT_METHODS, RECURRENCE_FREQUENCIES, TRANSACTION_TYPES } from '@khata/shared';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { dateSchema, idParamSchema, objectIdSchema, positiveAmountSchema, text, validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as service from './recurring.service.js';

export const recurringRouter: Router = Router();

recurringRouter.use(requireAuth, requireWorkspace);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

const createSchema = z
  .object({
    name: z.string().trim().min(1, 'Give this a name.').max(60),
    type: z.enum(TRANSACTION_TYPES),
    amountMinor: positiveAmountSchema,
    accountId: objectIdSchema,
    toAccountId: objectIdSchema.optional(),
    categoryId: objectIdSchema.nullable().optional(),
    personId: objectIdSchema.nullable().optional(),
    description: text(200),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    intervalDays: z.number().int().min(1).max(3650).optional(),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    monthOfYear: z.number().int().min(1).max(12).optional(),
    startDate: dateSchema,
    endDate: dateSchema.nullable().optional(),
    autoPost: z.boolean().default(true),
    reminderDaysBefore: z.number().int().min(0).max(30).default(1),
    maxOccurrences: z.number().int().min(1).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.frequency === 'custom' && !value.intervalDays) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['intervalDays'], message: 'Set how many days between occurrences.' });
    }
    if (value.type === 'transfer' && !value.toAccountId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['toAccountId'], message: 'Choose the destination account.' });
    }
  });

const updateSchema = createSchema.innerType().partial().extend({ isPaused: z.boolean().optional() });

recurringRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listRecurring(scopeOf(req)));
  }),
);

recurringRouter.post(
  '/',
  writeLimiter,
  validate({ body: createSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const recurring = await service.createRecurring(scopeOf(req), req.body, auditContext(req));
    created(res, service.toRecurringDto(recurring));
  }),
);

recurringRouter.patch(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema, body: updateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const recurring = await service.updateRecurring(scopeOf(req), param(req, 'id'), req.body, auditContext(req));
    ok(res, service.toRecurringDto(recurring));
  }),
);

recurringRouter.delete(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteRecurring(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, { deleted: true });
  }),
);

recurringRouter.post(
  '/:id/run',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const recurring = await service.runRecurringNow(scopeOf(req), param(req, 'id'), auditContext(req));
    created(res, service.toRecurringDto(recurring));
  }),
);

recurringRouter.post(
  '/:id/skip',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const recurring = await service.skipNextOccurrence(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, service.toRecurringDto(recurring));
  }),
);
