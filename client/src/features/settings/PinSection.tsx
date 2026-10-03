import { useState } from 'react';
import { KeyRound, ShieldOff } from 'lucide-react';
import type { UserDto } from '@khata/shared';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { Field, Input, Select } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useT } from '../../i18n';

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
  const t = useT();
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
      toast.error(t('common.couldNotSaveThat'), errorMessage(err));
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
      if (user) setUser({ ...user, preferences: { ...user.preferences, security: { ...user.preferences.security, pinEnabled: true, pinLength: pin.length } } });
      toast.success(t('settings.pinSet'), t('settings.khataWillAskForItAfter'));
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
      if (user) setUser({ ...user, preferences: { ...user.preferences, security: { ...user.preferences.security, pinEnabled: false, pinLength: null } } });
      toast.success(t('settings.pinRemoved'));
      close();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-t border-line-faint pt-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-[13.5px] font-medium text-ink">{t('settings.appLockPin')}</p>
          <p className="mt-1 max-w-md text-[12px] leading-relaxed text-ink-muted">
            {t('settings.a48DigitCodeTo')}
          </p>
        </div>
        {pinEnabled ? (
          <Button variant="ghost" size="sm" className="text-negative hover:bg-negative-soft" leftIcon={<ShieldOff className="size-3.5" />} onClick={() => setOpen('remove')}>
            {t('settings.removePin')}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" leftIcon={<KeyRound className="size-3.5" />} onClick={() => setOpen('set')}>
            {t('settings.setAPin')}
          </Button>
        )}
      </div>

      {pinEnabled && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-lg border border-line bg-sunken p-3.5">
          <div className="min-w-0 flex-1 basis-48">
            <p className="text-[12.5px] font-medium text-ink">{t('settings.lockAfterInactivity')}</p>
            <p className="mt-0.5 text-[11px] text-ink-muted">{t('settings.khataAsksForYourPinAgain')}</p>
          </div>
          <Select
            value={String(user?.preferences.security.sessionTimeoutMinutes ?? 0)}
            onChange={(event) => void changeTimeout(Number(event.target.value))}
            disabled={savingTimeout}
            className="w-auto min-w-[140px]"
          >
            <option value="0">{t('settings.never')}</option>
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
        title={t('settings.setAnAppLockPin')}
        size="sm"
        busy={busy}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button variant="gold" loading={busy} disabled={pin.length < 4 || pin !== confirmPin || !password} onClick={() => void setPinNow()}>
              {t('settings.setPin')}
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
          <Field label={t('settings.newPin')} hint={t('settings.4To8Digits')}>
            {({ id }) => <Input id={id} type="password" inputMode="numeric" autoFocus value={pin} maxLength={8} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} />}
          </Field>
          <Field label={t('settings.confirmPin')}>
            {({ id }) => <Input id={id} type="password" inputMode="numeric" value={confirmPin} maxLength={8} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ''))} />}
          </Field>
          <Field label={t('settings.yourAccountPassword')} hint={t('settings.toConfirmThisIsReallyYou')}>
            {({ id }) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />}
          </Field>
        </form>
      </Sheet>

      <Sheet
        open={open === 'remove'}
        onClose={close}
        title={t('settings.removeTheAppLockPin')}
        size="sm"
        busy={busy}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={busy} disabled={!password} onClick={() => void removePinNow()}>
              {t('settings.removePin')}
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
          <Field label={t('settings.yourAccountPassword')}>
            {({ id }) => <Input id={id} type="password" autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />}
          </Field>
        </form>
      </Sheet>
    </section>
  );
}
