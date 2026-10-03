import { useState } from 'react';
import { Mail, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { UserDto } from '@khata/shared';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { Avatar } from '../people/PeoplePage';
import { useT } from '../../i18n';

export function ProfileSettings() {
  const t = useT();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [resending, setResending] = useState(false);

  if (!user) return null;
  // Rebind so closures below (`save`, `resendVerification`) see a type narrowed to
  // `UserDto`, not `UserDto | null` — TS resets narrowing across nested functions.
  const currentUser = user;
  const dirty = name.trim() !== currentUser.name || phone.trim() !== (currentUser.phone ?? '');

  async function save() {
    setBusy(true);
    setFieldErrors({});
    try {
      const updated = await api.patch<UserDto>('/users/me', {
        name: name.trim(),
        phone: phone.trim(),
      });
      setUser(updated);
      toast.success(t('settings.profileUpdated'));
    } catch (err) {
      if (err instanceof ApiRequestError && err.fields.length) {
        setFieldErrors(Object.fromEntries(err.fields.map((f) => [f.path, f.message])));
      }
      toast.error(t('settings.couldNotSave'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setResending(true);
    try {
      await api.post('/auth/resend-verification');
      toast.success(t('settings.confirmationEmailSent'), t('settings.check', { email: currentUser.email }));
    } catch (err) {
      toast.error(t('settings.couldNotSendThat'), errorMessage(err));
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Avatar name={user.name} avatarUrl={user.avatarUrl} size="lg" />
        <div className="min-w-0">
          <p className="break-words text-[14px] font-semibold text-ink">{user.name}</p>
          <p className="text-[12.5px] text-ink-muted wrap-anywhere">{user.email}</p>
        </div>
      </div>

      {/* Email verification (§5) — directly actionable, not buried. */}
      <div
        className={`flex items-start gap-3 rounded-lg border p-4 ${
          user.emailVerified ? 'border-positive/25 bg-positive-soft' : 'border-warning/25 bg-warning-soft'
        }`}
      >
        {user.emailVerified ? (
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-positive" />
        ) : (
          <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">
            {user.emailVerified ? t('auth.emailConfirmed') : t('settings.confirmYourEmailAddress')}
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
            {user.emailVerified
              ? t('settings.passwordRecoveryIsFullyAvailable')
              : t('settings.youNeedAConfirmedAddressTo')}
          </p>
          {!user.emailVerified && (
            <Button
              size="sm"
              variant="secondary"
              // Allowed to wrap onto two lines rather than overflow the notice on a narrow phone.
              className="mt-3 h-auto min-h-9 max-w-full whitespace-normal py-1.5 text-left"
              loading={resending}
              leftIcon={<Mail className="size-3.5" />}
              onClick={() => void resendVerification()}
            >
              {t('settings.resendConfirmationEmail')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('common.name')} error={fieldErrors.name} required>
          {({ id }) => <Input id={id} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <Field label={t('common.phone')} error={fieldErrors.phone} hint={t('common.optional')}>
          {({ id }) => <Input id={id} type="tel" value={phone} maxLength={24} onChange={(event) => setPhone(event.target.value)} />}
        </Field>
      </div>

      <Field label={t('common.email')}>
        {({ id }) => (
          <div className="flex items-center gap-2">
            <Input id={id} value={user.email} disabled className="flex-1" />
            <Badge tone={user.emailVerified ? 'positive' : 'warning'}>
              {user.emailVerified ? t('settings.verified') : t('settings.unverified')}
            </Badge>
          </div>
        )}
      </Field>

      <div className="flex justify-end border-t border-line-faint pt-5">
        <Button variant="gold" loading={busy} disabled={!dirty || !name.trim()} onClick={() => void save()}>
          {t('common.saveChanges')}
        </Button>
      </div>
    </div>
  );
}
