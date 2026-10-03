import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { RECURRENCE_FREQUENCIES } from '@khata/shared';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { scopeOf } from '../../middleware/context.js';
import { objectIdSchema, positiveAmountSchema, text, validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { toRecurringDto } from '../recurring/recurring.service.js';
import * as service from './detector.service.js';

export const detectorRouter: Router = Router();

detectorRouter.use(requireAuth, requireWorkspace);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

detectorRouter.get(
  '/subscriptions',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.detectSubscriptions(scopeOf(req)));
  }),
);

const signatureSchema = z.object({ signature: z.string().min(1).max(200) });

detectorRouter.post(
  '/subscriptions/dismiss',
  writeLimiter,
  validate({ body: signatureSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.dismissSuggestion(scopeOf(req), req.body.signature);
    ok(res, { dismissed: true });
  }),
);

const createBillSchema = signatureSchema.extend({
  description: text(200),
  amountMinor: positiveAmountSchema,
  accountId: objectIdSchema,
  categoryId: objectIdSchema.optional(),
  payeeId: objectIdSchema.optional(),
  frequency: z.enum(RECURRENCE_FREQUENCIES),
  nextExpectedDate: z.string().datetime(),
});

detectorRouter.post(
  '/subscriptions/create-bill',
  writeLimiter,
  validate({ body: createBillSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const recurring = await service.createBillFromSuggestion(scopeOf(req), req.body, auditContext(req));
    created(res, toRecurringDto(recurring));
  }),
);
