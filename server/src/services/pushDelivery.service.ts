import type { Types } from 'mongoose';
import { PushSubscription, User } from '../models/index.js';
import { sendPush } from '../lib/push.js';
import { env } from '../config/env.js';

/**
 * Fan a single in-app notification out to every browser the user has enabled
 * push on (§41). Called right after the notification itself is written, from
 * the same four producers that write to the `Notification` collection — never
 * on its own, so push can never fire without a matching in-app entry.
 *
 * Gated by the user's own `push` preference (on top of whichever topic switch
 * already decided the notification should exist at all), and a no-op entirely
 * when VAPID keys aren't configured — a deployer who hasn't set those up sees
 * no behaviour change, just no push.
 */
export async function deliverPushToUser(
  userId: Types.ObjectId,
  payload: { title: string; body: string; link?: string },
): Promise<void> {
  if (!env.pushConfigured) return;

  const user = await User.findById(userId).select('preferences.notifications.push').lean();
  if (user?.preferences?.notifications?.push !== true) return;

  const subscriptions = await PushSubscription.find({ userId }).lean();
  if (subscriptions.length === 0) return;

  const gone: Types.ObjectId[] = [];
  await Promise.all(
    subscriptions.map(async (sub) => {
      const result = await sendPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        payload,
      );
      if (result === 'gone') gone.push(sub._id);
    }),
  );

  if (gone.length > 0) {
    await PushSubscription.deleteMany({ _id: { $in: gone } });
  }
}
