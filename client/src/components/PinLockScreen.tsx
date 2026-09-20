import { useEffect, useState } from 'react';
import { Delete, Lock, LogOut } from 'lucide-react';
import { LogoMark } from './brand/Logo';
import { useUiStore } from '../stores/ui.store';
import { useAuthStore } from '../stores/auth.store';
import { api, ApiRequestError } from '../lib/api';

/**
 * The app-lock PIN screen (§37).
 *
 * Covers the entire UI once `useIdleLock` decides the session has been idle too
 * long. Verifying the PIN unlocks the screen the app was already showing rather
 * than issuing a new session — a correct PIN is not a second login, it's proof
 * the person holding the unlocked device is still the person who unlocked it.
 */
export function PinLockScreen() {
  const locked = useUiStore((s) => s.locked);
  const setLocked = useUiStore((s) => s.setLocked);
  const signOut = useAuthStore((s) => s.signOut);
  const userName = useAuthStore((s) => s.user?.name?.split(' ')[0] ?? '');

  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (!locked) {
      setPin('');
      setError(null);
    }
  }, [locked]);

  useEffect(() => {
    if (pin.length >= 4) void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/pin/verify', { pin });
      setLocked(false);
    } catch (err) {
      setPin('');
      setShake(true);
      setTimeout(() => setShake(false), 400);
      setError(err instanceof ApiRequestError ? err.message : 'Could not verify that PIN.');
    } finally {
      setBusy(false);
    }
  }

  if (!locked) return null;

  function press(digit: string) {
    if (busy || pin.length >= 8) return;
    setPin((current) => current + digit);
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-canvas pb-safe pt-safe">
      <LogoMark className="size-10" />

      <div className="mt-6 flex items-center gap-2 text-ink-secondary">
        <Lock aria-hidden className="size-4" />
        <p className="text-[14px] font-medium">
          {userName ? `Welcome back, ${userName}` : 'Enter your PIN'}
        </p>
      </div>

      <div
        role="alert"
        aria-live="assertive"
        className={`mt-6 flex gap-3 ${shake ? 'animate-[shake_0.4s_ease-in-out]' : ''}`}
      >
        {Array.from({ length: 6 }).map((_, index) => (
          <span
            key={index}
            aria-hidden
            className={`size-3 rounded-full border-2 transition-colors ${
              index < pin.length ? 'border-gold bg-gold' : 'border-line-strong bg-transparent'
            }`}
          />
        ))}
      </div>

      <p className="mt-3 h-4 text-[12.5px] text-negative">{error}</p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <NumberKey key={digit} label={digit} onClick={() => press(digit)} disabled={busy} />
        ))}
        <span />
        <NumberKey label="0" onClick={() => press('0')} disabled={busy} />
        <button
          type="button"
          onClick={() => setPin((current) => current.slice(0, -1))}
          disabled={busy || pin.length === 0}
          aria-label="Delete digit"
          className="flex size-16 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-sunken disabled:opacity-30"
        >
          <Delete aria-hidden className="size-5" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => void signOut()}
        className="mt-10 flex items-center gap-1.5 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink"
      >
        <LogOut aria-hidden className="size-3.5" />
        Sign in with password instead
      </button>
    </div>
  );
}

function NumberKey({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex size-16 items-center justify-center rounded-full text-[22px] font-medium text-ink transition-colors hover:bg-sunken active:bg-line disabled:opacity-40"
    >
      {label}
    </button>
  );
}
