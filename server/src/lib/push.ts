import webpush from 'web-push';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Browser push delivery.
 *
 * With no VAPID key pair configured, push is silently skipped — unlike email,
 * this channel has no security-sensitive flows (no password resets go through
 * it), so there is nothing to refuse in production. In-app notifications are
 * unaffected either way; push is always a second channel, never the only one.
 */
let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  if (!env.pushConfigured) return false;
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  configured = true;
  return true;
}

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  link?: string;
}

export type PushSendResult = 'sent' | 'skipped' | 'gone';

/** Returns 'gone' when the browser has revoked the subscription — the caller should delete it. */
export async function sendPush(subscription: PushSubscriptionKeys, payload: PushPayload): Promise<PushSendResult> {
  if (!ensureConfigured()) return 'skipped';

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    );
    return 'sent';
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) return 'gone';
    logger.error({ err }, 'Failed to send push notification');
    return 'skipped';
  }
}

export function getVapidPublicKey(): string | null {
  return env.pushConfigured ? env.VAPID_PUBLIC_KEY! : null;
}
