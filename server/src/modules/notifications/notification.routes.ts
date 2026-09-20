import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { NotificationDto } from '@khata/shared';
import { Notification } from '../../models/index.js';
import { asyncHandler, ok } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { param, userIdOf } from '../../middleware/context.js';
import { idParamSchema, validate } from '../../middleware/validate.js';
import { notFound } from '../../lib/errors.js';

/**
 * The notification centre (§41).
 *
 * Deliberately scoped by user, not by workspace: a backup-status notice or a
 * security alert applies to the account as a whole, not to whichever workspace
 * happens to be active when it fires.
 */
export const notificationRouter: Router = Router();

notificationRouter.use(requireAuth);

function toDto(doc: {
  _id: unknown;
  type: NotificationDto['type'];
  title: string;
  body: string;
  icon: string;
  link?: string;
  isRead: boolean;
  createdAt: Date;
}): NotificationDto {
  return {
    id: String(doc._id),
    type: doc.type,
    title: doc.title,
    body: doc.body,
    icon: doc.icon,
    link: doc.link,
    isRead: doc.isRead,
    createdAt: doc.createdAt.toISOString(),
  };
}

notificationRouter.get(
  '/',
  validate({
    query: z.object({
      unreadOnly: z.coerce.boolean().default(false),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { unreadOnly, limit } = req.query as unknown as { unreadOnly: boolean; limit: number };
    const filter: Record<string, unknown> = { userId: userIdOf(req) };
    if (unreadOnly) filter.isRead = false;

    const [items, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
      Notification.countDocuments({ userId: userIdOf(req), isRead: false }),
    ]);

    ok(res, items.map(toDto), { unreadCount });
  }),
);

notificationRouter.post(
  '/:id/read',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const notification = await Notification.findOneAndUpdate(
      { _id: param(req, 'id'), userId: userIdOf(req) },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true },
    );
    if (!notification) throw notFound('Notification');
    ok(res, toDto(notification));
  }),
);

notificationRouter.post(
  '/read-all',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await Notification.updateMany(
      { userId: userIdOf(req), isRead: false },
      { $set: { isRead: true, readAt: new Date() } },
    );
    ok(res, { updated: result.modifiedCount });
  }),
);

notificationRouter.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await Notification.deleteOne({ _id: param(req, 'id'), userId: userIdOf(req) });
    if (result.deletedCount === 0) throw notFound('Notification');
    ok(res, { deleted: true });
  }),
);
