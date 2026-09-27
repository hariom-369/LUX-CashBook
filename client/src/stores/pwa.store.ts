import { create } from 'zustand';

/**
 * The browser's deferred install prompt (Chromium's `beforeinstallprompt`). Not in
 * the DOM typings; only the parts the app uses are declared.
 */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  updateAvailable: boolean;
  applyUpdate: (() => void) | null;
  setUpdateAvailable: (available: boolean, applyUpdate?: () => void) => void;
  /**
   * Present only while the browser says Khata can be installed right now — so an
   * "Install Khata" action is never shown where it can't work (iOS Safari, an
   * already-installed app, a browser without install support).
   */
  installPrompt: InstallPromptEvent | null;
  setInstallPrompt: (event: InstallPromptEvent | null) => void;
}

export const usePwaStore = create<PwaState>((set) => ({
  updateAvailable: false,
  applyUpdate: null,
  setUpdateAvailable: (updateAvailable, applyUpdate) => set({ updateAvailable, applyUpdate: applyUpdate ?? null }),
  installPrompt: null,
  setInstallPrompt: (installPrompt) => set({ installPrompt }),
}));
