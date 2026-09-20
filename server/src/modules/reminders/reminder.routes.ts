import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { REMINDER_TYPES } from '@khata/shared';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { actorOf, requireAuth, requireWorkspace } from '../../middleware/auth.js';
import { param, scopeOf } from '../../middleware/context.js';
import { amountMinorSchema, dateSchema, idParamSchema, objectIdSchema, text, validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import * as service from './reminder.service.js';

export const reminderRouter: Router = Router();

reminderRouter.use(requireAuth, requireWorkspace);

const auditContext = (req: Request) => {
  const scope = scopeOf(req);
  return { userId: scope.userId, workspaceId: scope.workspaceId, ...actorOf(req) };
};

const createSchema = z.object({
  type: z.enum(REMINDER_TYPES).default('custom'),
  title: z.string().trim().min(1, 'Give this reminder a title.').max(120),
  amountMinor: amountMinorSchema.refine((n) => n >= 0, 'Amount cannot be negative.').optional(),
  dueDate: dateSchema,
  personId: objectIdSchema.nullable().optional(),
  notes: text(500),
  notifyDaysBefore: z.number().int().min(0).max(60).default(1),
});

reminderRouter.get(
  '/',
  validate({ query: z.object({ includeDone: z.coerce.boolean().default(false) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listReminders(scopeOf(req), req.query as { includeDone?: boolean }));
  }),
);

reminderRouter.post(
  '/',
  writeLimiter,
  validate({ body: createSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const reminder = await service.createReminder(scopeOf(req), req.body, auditContext(req));
    created(res, service.toReminderDto(reminder));
  }),
);

reminderRouter.patch(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema, body: createSchema.partial() }),
  asyncHandler(async (req: Request, res: Response) => {
    const reminder = await service.updateReminder(scopeOf(req), param(req, 'id'), req.body, auditContext(req));
    ok(res, service.toReminderDto(reminder));
  }),
);

reminderRouter.post(
  '/:id/complete',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const reminder = await service.completeReminder(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, service.toReminderDto(reminder));
  }),
);

reminderRouter.delete(
  '/:id',
  writeLimiter,
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteReminder(scopeOf(req), param(req, 'id'), auditContext(req));
    ok(res, { deleted: true });
  }),
);
