import { useState } from 'react';
import { KeyRound, ShieldOff } from 'lucide-react';
import type { UserDto } from '@khata/shared';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { Field, Input, Select } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { api, ApiRequestError, errorMessage } from '../../lib/api';

const TIMEOUT_OPTIONS = [
  { minutes: 1, label: '1 minute' },
  { minutes: 5, label: '5 minutes' },
  { minutes: 15, label: '15 minutes' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
];

/**
 * App-lock PIN (§37).
 *
 * A PIN unlocks the *UI* on a device that is already signed in — it is not a
 * second authentication factor for the API, and setting or removing it requires
 * the account password to confirm the change is really coming from the account
 * owner. The lock screen itself lives in `components/PinLockScreen.tsx`.
 */
export function PinSection() {
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const pinEnabled = user?.preferences.security.pinEnabled ?? false;

  const [open, setOpen] = useState<'set' | 'remove' | null>(null);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingTimeout, setSavingTimeout] = useState(false);

  async function changeTimeout(minutes: number) {
    setSavingTimeout(true);
    try {
      const updated = await api.patch<UserDto>('/users/me/preferences', { security: { sessionTimeoutMinutes: minutes } });
      setUser(updated);
    } catch (err) {
      toast.error('Could not save that', errorMessage(err));
    } finally {
      setSavingTimeout(false);
    }
  }

  function close() {
    setOpen(null);
    setPin('');
    setConfirmPin('');
    setPassword('');
    setError(null);
  }

  async function setPinNow() {
    if (pin.length < 4 || pin !== confirmPin) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/pin', { pin, password });
      if (user) setUser({ ...user, preferences: { ...user.preferences, security: { ...user.preferences.security, pinEnabled: true } } });
      toast.success('PIN set', 'Khata will ask for it after a period of inactivity.');
      close();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function removePinNow() {
    setBusy(true);
    setError(null);
    try {
      await api.delete('/auth/pin', { password });
      if (user) setUser({ ...user, preferences: { ...user.preferences, security: { ...user.preferences.security, pinEnabled: false } } });
      toast.success('PIN removed');
      close();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-t border-line-faint pt-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13.5px] font-medium text-ink">App-lock PIN</p>
          <p className="mt-1 max-w-md text-[12px] leading-relaxed text-ink-muted">
            A 4–8 digit code to unlock Khata quickly on this device without your full password.
          </p>
        </div>
        {pinEnabled ? (
          <Button variant="ghost" size="sm" className="text-negative hover:bg-negative-soft" leftIcon={<ShieldOff className="size-3.5" />} onClick={() => setOpen('remove')}>
            Remove PIN
          </Button>
        ) : (
          <Button variant="secondary" size="sm" leftIcon={<KeyRound className="size-3.5" />} onClick={() => setOpen('set')}>
            Set a PIN
          </Button>
        )}
      </div>

      {pinEnabled && (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-line bg-sunken p-3.5">
          <div>
            <p className="text-[12.5px] font-medium text-ink">Lock after inactivity</p>
            <p className="mt-0.5 text-[11px] text-ink-muted">Khata asks for your PIN again after this much idle time.</p>
          </div>
          <Select
            value={String(user?.preferences.security.sessionTimeoutMinutes ?? 0)}
            onChange={(event) => void changeTimeout(Number(event.target.value))}
            disabled={savingTimeout}
            className="w-auto min-w-[140px]"
          >
            <option value="0">Never</option>
            {TIMEOUT_OPTIONS.map((option) => (
              <option key={option.minutes} value={option.minutes}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      <Sheet
        open={open === 'set'}
        onClose={close}
        title="Set an app-lock PIN"
        size="sm"
        busy={busy}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button variant="gold" loading={busy} disabled={pin.length < 4 || pin !== confirmPin || !password} onClick={() => void setPinNow()}>
              Set PIN
            </Button>
          </div>
        }
      >
        <form onSubmit={(event) => { event.preventDefault(); void setPinNow(); }} className="flex flex-col gap-4 pb-2">
          {error && (
            <div role="alert" className="rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] text-negative">
              {error}
            </div>
          )}
          <Field label="New PIN" hint="4 to 8 digits.">
            {({ id }) => <Input id={id} type="password" inputMode="numeric" autoFocus value={pin} maxLength={8} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} />}
          </Field>
          <Field label="Confirm PIN">
            {({ id }) => <Input id={id} type="password" inputMode="numeric" value={confirmPin} maxLength={8} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ''))} />}
          </Field>
          <Field label="Your account password" hint="To confirm this is really you.">
            {({ id }) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />}
          </Field>
        </form>
      </Sheet>

      <Sheet
        open={open === 'remove'}
        onClose={close}
        title="Remove the app-lock PIN?"
        size="sm"
        busy={busy}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} disabled={!password} onClick={() => void removePinNow()}>
              Remove PIN
            </Button>
          </div>
        }
      >
        <form onSubmit={(event) => { event.preventDefault(); void removePinNow(); }} className="pb-2">
          {error && (
            <div role="alert" className="mb-4 rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] text-negative">
              {error}
            </div>
          )}
          <Field label="Your account password">
            {({ id }) => <Input id={id} type="password" autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />}
          </Field>
        </form>
      </Sheet>
    </section>
  );
}
