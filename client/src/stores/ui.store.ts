import { create } from 'zustand';
import type { Theme } from '@khata/shared';
import type { ParsedQuickEntry } from '../lib/naturalLanguageEntry';

/**
 * UI state that must survive a reload but never belongs on the server:
 * theme, privacy mode, sidebar collapse.
 *
 * Both theme and privacy mode are applied by toggling a class on `<html>` rather
 * than by re-rendering. That is what makes privacy mode (§38) reliable — a CSS rule
 * cannot forget to mask a component the way a prop drilled through 40 files can.
 * The inline script in `index.html` applies the same classes before first paint so
 * there is no flash of the wrong state.
 */

const THEME_KEY = 'khata.theme';
const PRIVACY_KEY = 'khata.privacy';
const SIDEBAR_KEY = 'khata.sidebar';
const LANGUAGE_KEY = 'khata.language';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private browsing and blocked site data both throw; defaults are fine.
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Non-fatal: the preference simply won't persist. */
  }
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return prefersDark() ? 'dark' : 'light';
  return theme;
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const dark = resolveTheme(theme) === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e0e0c' : '#f7f5f0');
}

function applyPrivacy(enabled: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('privacy', enabled);
}

interface UiState {
  theme: Theme;
  privacyMode: boolean;
  sidebarCollapsed: boolean;
  /** The language this device shows while nobody is signed in (login, register, reset). A signed-in user's own preference wins. */
  deviceLanguage: string;
  commandPaletteOpen: boolean;
  quickAddOpen: boolean;
  /** Set by the Assistant (§Phase 10) before opening Quick Add, so a parsed draft lands straight on the review form — consumed once, then cleared. */
  quickAddPrefill: ParsedQuickEntry | null;
  mobileNavOpen: boolean;
  /** The app-lock PIN screen (§37) is covering the UI until this clears. */
  locked: boolean;

  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setPrivacyMode: (enabled: boolean) => void;
  togglePrivacyMode: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setDeviceLanguage: (language: string) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setQuickAddOpen: (open: boolean) => void;
  openQuickAddWithPrefill: (prefill: ParsedQuickEntry) => void;
  consumeQuickAddPrefill: () => ParsedQuickEntry | null;
  setMobileNavOpen: (open: boolean) => void;
  setLocked: (locked: boolean) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: (readStorage(THEME_KEY) as Theme | null) ?? 'system',
  privacyMode: readStorage(PRIVACY_KEY) === '1',
  sidebarCollapsed: readStorage(SIDEBAR_KEY) === '1',
  deviceLanguage: (() => {
    const stored = readStorage(LANGUAGE_KEY);
    return stored && /^[a-z]{2,3}$/.test(stored) ? stored : 'en';
  })(),
  commandPaletteOpen: false,
  quickAddOpen: false,
  quickAddPrefill: null,
  mobileNavOpen: false,
  locked: false,

  setTheme(theme) {
    writeStorage(THEME_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },

  toggleTheme() {
    // Cycling light → dark → system would strand users in "system" by accident;
    // the toggle flips between the two explicit modes and Settings offers system.
    const next = resolveTheme(get().theme) === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },

  setPrivacyMode(enabled) {
    writeStorage(PRIVACY_KEY, enabled ? '1' : '0');
    applyPrivacy(enabled);
    set({ privacyMode: enabled });
  },

  togglePrivacyMode() {
    get().setPrivacyMode(!get().privacyMode);
  },

  setSidebarCollapsed(collapsed) {
    writeStorage(SIDEBAR_KEY, collapsed ? '1' : '0');
    set({ sidebarCollapsed: collapsed });
  },

  toggleSidebar() {
    get().setSidebarCollapsed(!get().sidebarCollapsed);
  },

  setDeviceLanguage(language) {
    writeStorage(LANGUAGE_KEY, language);
    set({ deviceLanguage: language });
  },

  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setQuickAddOpen: (quickAddOpen) => set({ quickAddOpen }),
  openQuickAddWithPrefill: (prefill) => set({ quickAddPrefill: prefill, quickAddOpen: true }),
  consumeQuickAddPrefill: () => {
    const prefill = get().quickAddPrefill;
    if (prefill) set({ quickAddPrefill: null });
    return prefill;
  },
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
  setLocked: (locked) => set({ locked }),
}));

/**
 * Keep "system" theme live: if the OS flips to dark at sunset, so does the app —
 * but only while the user has actually chosen "system".
 */
export function watchSystemTheme(): () => void {
  if (typeof window === 'undefined') return () => {};
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (useUiStore.getState().theme === 'system') applyTheme('system');
  };
  media.addEventListener('change', handler);
  return () => media.removeEventListener('change', handler);
}
