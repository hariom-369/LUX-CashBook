import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Laptop, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { ConfirmDialog } from '../../components/ui/Sheet';
import { useToast } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { PinSection } from './PinSection';

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z.string().min(10, 'Use at least 10 characters.').max(256),
    confirm: z.string().min(1, 'Type the new password again.'),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Those passwords do not match.' });

type PasswordForm = z.infer<typeof passwordSchema>;

interface Session {
  id: string;
  userAgent: string;
  ipAddress?: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

/**
 * Security settings (§37).
 *
 * Changing the password signs out every other session immediately — the server
 * bumps the token version and revokes every refresh token, so this page's job is
 * only to explain that plainly before it happens.
 */
export function SecuritySettings() {
  const toast = useToast();
  const signOut = useAuthStore((s) => s.signOut);

  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmSignOutAll, setConfirmSignOutAll] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);

  useEffect(() => {
    api
      .get<Session[]>('/users/me/sessions')
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });

  async function onSubmit(values: PasswordForm) {
    try {
      await api.post('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast.success('Password changed', 'You were signed out everywhere else.');
      reset();
      await signOut();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'INVALID_CREDENTIALS') {
          setError('currentPassword', { message: err.message });
          return;
        }
      }
      toast.error('Could not change your password', errorMessage(err));
    }
  }

  async function revokeSession(id: string) {
    setRevoking(id);
    try {
      await api.delete(`/users/me/sessions/${id}`);
      setSessions((current) => current?.filter((s) => s.id !== id) ?? null);
      toast.success('Session signed out');
    } catch (err) {
      toast.error('Could not sign that session out', errorMessage(err));
    } finally {
      setRevoking(null);
    }
  }

  async function signOutEverywhere() {
    setSigningOutAll(true);
    try {
      await api.post('/auth/logout-all');
      await signOut();
    } catch (err) {
      toast.error('Could not sign out everywhere', errorMessage(err));
      setSigningOutAll(false);
      setConfirmSignOutAll(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <p className="text-[13.5px] font-medium text-ink">Change password</p>
        <p className="mt-1 text-[12px] text-ink-muted">
          Changing your password signs out every other session immediately.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4 flex flex-col gap-4 sm:max-w-sm">
          <Field label="Current password" error={errors.currentPassword?.message}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} type="password" autoComplete="current-password" aria-describedby={describedBy} invalid={invalid} {...register('currentPassword')} />
            )}
          </Field>
          <Field label="New password" error={errors.newPassword?.message}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} type="password" autoComplete="new-password" aria-describedby={describedBy} invalid={invalid} {...register('newPassword')} />
            )}
          </Field>
          <Field label="Confirm new password" error={errors.confirm?.message}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} type="password" autoComplete="new-password" aria-describedby={describedBy} invalid={invalid} {...register('confirm')} />
            )}
          </Field>
          <Button type="submit" variant="gold" loading={isSubmitting} className="w-fit">
            Change password
          </Button>
        </form>
      </section>

      <PinSection />

      <section className="border-t border-line-faint pt-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[13.5px] font-medium text-ink">Active sessions</p>
            <p className="mt-1 text-[12px] text-ink-muted">Devices currently signed in to your account.</p>
          </div>
          {sessions && sessions.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-negative hover:bg-negative-soft"
              leftIcon={<LogOut className="size-3.5" />}
              onClick={() => setConfirmSignOutAll(true)}
            >
              Sign out everywhere
            </Button>
          )}
        </div>

        <ul className="mt-4 flex flex-col divide-y divide-line-faint rounded-lg border border-line">
          {(sessions ?? []).map((session) => (
            <li key={session.id} className="flex items-center gap-3 px-4 py-3">
              {/Mobile|Android|iPhone/i.test(session.userAgent) ? (
                <Smartphone aria-hidden className="size-4 shrink-0 text-ink-muted" />
              ) : (
                <Laptop aria-hidden className="size-4 shrink-0 text-ink-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-[13px] font-medium text-ink">
                  {shortUserAgent(session.userAgent)}
                  {session.isCurrent && (
                    <span className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-positive">
                      <ShieldCheck className="size-3" /> This device
                    </span>
                  )}
                </p>
                <p className="truncate text-[11px] text-ink-muted">
                  {session.ipAddress ?? 'Unknown location'}
                </p>
              </div>
              {!session.isCurrent && (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={revoking === session.id}
                  onClick={() => void revokeSession(session.id)}
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}

          {sessions?.length === 0 && (
            <li className="px-4 py-4 text-[12.5px] text-ink-muted">No other active sessions.</li>
          )}
        </ul>
      </section>

      <ConfirmDialog
        open={confirmSignOutAll}
        onCancel={() => setConfirmSignOutAll(false)}
        onConfirm={signOutEverywhere}
        title="Sign out everywhere?"
        description="Every device, including this one, will need to sign in again."
        confirmLabel="Sign out everywhere"
        tone="danger"
        busy={signingOutAll}
      />
    </div>
  );
}

function shortUserAgent(ua: string): string {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return 'Android device';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  return 'Unknown device';
}
