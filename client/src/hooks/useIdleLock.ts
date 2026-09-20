import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/auth.store';
import { useUiStore } from '../stores/ui.store';

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;

/**
 * Session timeout → app lock (§37).
 *
 * Only engages when the user has both set a PIN and chosen a timeout — a PIN with
 * no timeout is "lock on demand", which is a legitimate choice this hook has to
 * leave alone. Activity resets a single timer rather than polling, so an idle
 * background tab costs nothing.
 */
export function useIdleLock(): void {
  const pinEnabled = useAuthStore((s) => s.user?.preferences.security.pinEnabled ?? false);
  const timeoutMinutes = useAuthStore((s) => s.user?.preferences.security.sessionTimeoutMinutes ?? 0);
  const status = useAuthStore((s) => s.status);
  const setLocked = useUiStore((s) => s.setLocked);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const active = status === 'authenticated' && pinEnabled && timeoutMinutes > 0;

    function clear() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    function arm() {
      clear();
      timerRef.current = setTimeout(() => useUiStore.getState().setLocked(true), timeoutMinutes * 60_000);
    }

    if (!active) {
      clear();
      return;
    }

    arm();
    const onActivity = () => arm();
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, onActivity, { passive: true });

    // Also lock immediately on returning to a hidden tab past its timeout,
    // rather than waiting for the next interaction to notice.
    let hiddenAt: number | null = null;
    function onVisibility() {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > timeoutMinutes * 60_000) {
        setLocked(true);
      } else {
        arm();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clear();
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pinEnabled, timeoutMinutes, status, setLocked]);
}
