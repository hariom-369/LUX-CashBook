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

export function ProfileSettings() {
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
      toast.success('Profile updated');
    } catch (err) {
      if (err instanceof ApiRequestError && err.fields.length) {
        setFieldErrors(Object.fromEntries(err.fields.map((f) => [f.path, f.message])));
      }
      toast.error('Could not save', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setResending(true);
    try {
      await api.post('/auth/resend-verification');
      toast.success('Confirmation email sent', `Check ${currentUser.email}.`);
    } catch (err) {
      toast.error('Could not send that', errorMessage(err));
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Avatar name={user.name} avatarUrl={user.avatarUrl} size="lg" />
        <div>
          <p className="text-[14px] font-semibold text-ink">{user.name}</p>
          <p className="text-[12.5px] text-ink-muted">{user.email}</p>
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
        <div className="flex-1">
          <p className="text-[13px] font-medium text-ink">
            {user.emailVerified ? 'Email confirmed' : 'Confirm your email address'}
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
            {user.emailVerified
              ? 'Password recovery is fully available.'
              : 'You need a confirmed address to reset your password if you ever lose access.'}
          </p>
          {!user.emailVerified && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              loading={resending}
              leftIcon={<Mail className="size-3.5" />}
              onClick={() => void resendVerification()}
            >
              Resend confirmation email
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={fieldErrors.name} required>
          {({ id }) => <Input id={id} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <Field label="Phone" error={fieldErrors.phone} hint="Optional">
          {({ id }) => <Input id={id} type="tel" value={phone} maxLength={24} onChange={(event) => setPhone(event.target.value)} />}
        </Field>
      </div>

      <Field label="Email">
        {({ id }) => (
          <div className="flex items-center gap-2">
            <Input id={id} value={user.email} disabled className="flex-1" />
            <Badge tone={user.emailVerified ? 'positive' : 'warning'}>
              {user.emailVerified ? 'Verified' : 'Unverified'}
            </Badge>
          </div>
        )}
      </Field>

      <div className="flex justify-end border-t border-line-faint pt-5">
        <Button variant="gold" loading={busy} disabled={!dirty || !name.trim()} onClick={() => void save()}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
