/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { API_CACHE } from './lib/cacheNames';

declare let self: ServiceWorkerGlobalScope;

/**
 * The offline app shell (§39).
 *
 * Two independent layers of "works without a connection":
 *
 *  1. **The shell.** `self.__WB_MANIFEST` is replaced at build time with the
 *     exact, hashed list of files this build produced — precached here so the UI
 *     itself (HTML, JS, CSS, fonts) loads with no network at all, not just a
 *     browser error page.
 *  2. **API reads.** GET requests to the API are served network-first with a
 *     cache fallback: fresh data when online, the last-seen response when not.
 *     This is what lets dashboards, transaction lists and ledgers stay *viewable*
 *     offline (§39) — not just the chrome around them.
 *
 * Writes are never intercepted here. A create/update/delete is handled entirely
 * by the app's own outbox (`lib/offlineDb.ts`) so the retry, the idempotency key,
 * and the "queued" UI state all live in one place instead of being split between
 * a service worker and application code that can't see each other's state.
 */

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Let the app ask this worker to take over immediately after a new version is
// downloaded, rather than waiting for every tab to close.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

registerRoute(
  ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/v1/') && isCacheableRead(url.pathname),
  new NetworkFirst({
    cacheName: API_CACHE,
    networkTimeoutSeconds: 4,
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 })],
  }),
);

// Fonts and other cross-origin static assets: fine to serve stale-while-fresh —
// they never change meaning, only occasionally change bytes.
registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com' || url.origin === 'https://fonts.googleapis.com',
  new StaleWhileRevalidate({ cacheName: 'khata-fonts-v1' }),
);

/**
 * Only GET endpoints whose data is meaningful to see stale are worth caching.
 * Auth, refresh and anything with side effects on the server must always hit the
 * network — caching a 401 or a one-time token would be actively wrong.
 */
function isCacheableRead(pathname: string): boolean {
  const readable = [
    '/api/v1/dashboard',
    '/api/v1/accounts',
    '/api/v1/transactions',
    '/api/v1/people',
    '/api/v1/categories',
    '/api/v1/cash-book',
    '/api/v1/budgets',
    '/api/v1/goals',
    '/api/v1/reports',
  ];
  return readable.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Browser push (§41, Phase 3 decision 9).
 *
 * The payload is whatever `lib/push.ts#sendPush` sent — always `{ title, body,
 * link? }`, never anything the server wouldn't also put in the in-app
 * notification, so there is nothing sensitive to leak through a system
 * notification tray.
 */
self.addEventListener('push', (event) => {
  let payload: { title?: string; body?: string; link?: string } = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { body: event.data?.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Khata', {
      body: payload.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { link: payload.link ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data as { link?: string } | undefined)?.link ?? '/';

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = clientsList.find((c) => 'focus' in c);
      if (existing) {
        await (existing as WindowClient).focus();
        existing.postMessage({ type: 'NAVIGATE', link });
        return;
      }
      await self.clients.openWindow(link);
    })(),
  );
});

export {};
