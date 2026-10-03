import { api } from './api';

/**
 * Browser push subscription management (§41, Phase 3 decision 9).
 *
 * The subscribe/unsubscribe pair is the only place that talks to
 * `PushManager` directly — `NotificationSettings` just calls these and
 * reflects the result, so the browser-API quirks (permission prompts, a
 * missing VAPID key meaning the server hasn't configured push yet) live in
 * one place.
 */

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function enablePush(): Promise<'subscribed' | 'unsupported' | 'denied' | 'unavailable'> {
  if (!isPushSupported()) return 'unsupported';

  const { publicKey } = await api.get<{ publicKey: string | null }>('/push/public-key');
  if (!publicKey) return 'unavailable';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey) as BufferSource,
    }));

  const json = subscription.toJSON();
  await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
  return 'subscribed';
}

export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await api.post('/push/unsubscribe', { endpoint }).catch(() => undefined);
}
