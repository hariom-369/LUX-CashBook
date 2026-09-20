import { registerSW } from 'virtual:pwa-register';
import { usePwaStore } from '../stores/pwa.store';

/**
 * Register the offline app shell (§39).
 *
 * `registerType: 'prompt'` in `vite.config.ts` is a deliberate choice for a
 * financial app: auto-updating a service worker mid-session can swap the running
 * code out from under a half-filled form. Instead, a new version downloads
 * quietly in the background and `onNeedRefresh` only fires once it's fully
 * cached — surfaced as an unintrusive "Update available" prompt the user acts on
 * when it suits them (`UpdateBanner`), never a forced reload.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      usePwaStore.getState().setUpdateAvailable(true, () => void updateSW(true));
    },
    onOfflineReady() {
      // Nothing to announce — quietly being ready is the whole point of an app
      // shell; a toast here would just be noise on every first visit.
    },
  });
}
