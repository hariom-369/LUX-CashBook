import type { Types } from 'mongoose';
import { User } from '../models/index.js';

/**
 * Which of the user's notification switches governs a notification.
 *
 * `always` covers things the user asked for directly (a reminder they created
 * themselves, a goal they reached) — they are still subject to the in-app master
 * switch, just not to a topic switch.
 */
export type NotificationTopic = 'moneyDue' | 'budgetAlerts' | 'recurringReminders' | 'always';

interface NotificationPrefs {
  inApp?: boolean;
  moneyDue?: boolean;
  budgetAlerts?: boolean;
  recurringReminders?: boolean;
}

/**
 * The one place that decides whether an in-app notification may be created.
 *
 * Every producer (budget alerts, reminders, recurring items, goals) asks this
 * before writing, so the switches on the Notifications settings screen actually
 * do what they say. A missing preference counts as "on" — the defaults are on.
 */
export async function isNotificationAllowed(
  userId: Types.ObjectId,
  topic: NotificationTopic,
  cache?: Map<string, NotificationPrefs>,
): Promise<boolean> {
  const key = String(userId);
  let prefs = cache?.get(key);
  if (!prefs) {
    const user = await User.findById(userId).select('preferences.notifications').lean();
    prefs = (user?.preferences?.notifications ?? {}) as NotificationPrefs;
    cache?.set(key, prefs);
  }

  if (prefs.inApp === false) return false;
  if (topic === 'always') return true;
  return prefs[topic] !== false;
}
