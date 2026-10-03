import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PushSubscription } from '../../models/index.js';
import { asyncHandler, ok } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { userIdOf } from '../../middleware/context.js';
import { validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { getVapidPublicKey } from '../../lib/push.js';
import { badRequest } from '../../lib/errors.js';

/**
 * Only known browser push services are ever valid `endpoint` hosts — the
 * server itself POSTs to this URL on every notification (`lib/push.ts`), so
 * an unrestricted URL would let any signed-in user turn the server into an
 * SSRF proxy against an internal/arbitrary host of their choosing.
 */
const ALLOWED_PUSH_HOST_SUFFIXES = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'notify.windows.com',
];

function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') return false;
    return ALLOWED_PUSH_HOST_SUFFIXES.some((suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

/**
 * Browser push subscriptions (§41, Phase 3 decision 9).
 *
 * Scoped by user, not workspace — a device keeps receiving alerts across a
 * workspace switch, same reasoning as the notification centre itself.
 */
export const pushRouter: Router = Router();

pushRouter.get(
  '/public-key',
  asyncHandler(async (_req: Request, res: Response) => {
    ok(res, { publicKey: getVapidPublicKey() });
  }),
);

pushRouter.use(requireAuth);

const subscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
});

pushRouter.post(
  '/subscribe',
  writeLimiter,
  validate({ body: subscribeSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { endpoint, keys } = req.body as z.infer<typeof subscribeSchema>;
    if (!isAllowedPushEndpoint(endpoint)) {
      throw badRequest('That push endpoint is not a recognised browser push service.');
    }
    await PushSubscription.updateOne(
      { userId: userIdOf(req), endpoint },
      { $set: { userId: userIdOf(req), endpoint, p256dh: keys.p256dh, auth: keys.auth } },
      { upsert: true },
    );
    ok(res, { subscribed: true });
  }),
);

pushRouter.post(
  '/unsubscribe',
  writeLimiter,
  validate({ body: z.object({ endpoint: z.string().url().max(1000) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    await PushSubscription.deleteOne({ userId: userIdOf(req), endpoint: req.body.endpoint });
    ok(res, { unsubscribed: true });
  }),
);
