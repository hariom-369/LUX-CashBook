import { registerSW } from 'virtual:pwa-register';
import { usePwaStore, type InstallPromptEvent } from '../stores/pwa.store';

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
  // Keep the browser's install prompt for the "Install Khata" menu item rather
  // than letting it fire at an arbitrary moment; drop it once installed.
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    usePwaStore.getState().setInstallPrompt(event as InstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => usePwaStore.getState().setInstallPrompt(null));

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
