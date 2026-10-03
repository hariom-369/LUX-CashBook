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
import { SecurityActivitySection } from './SecurityActivitySection';
import { DeleteAccountSection } from './DeleteAccountSection';
import { isMobileUserAgent, shortUserAgent } from './userAgent';
import { useT } from '../../i18n';

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'settings.enterYourCurrentPassword'),
    newPassword: z.string().min(10, 'auth.useAtLeast10Characters').max(256),
    confirm: z.string().min(1, 'settings.typeTheNewPasswordAgain'),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'auth.thosePasswordsDoNotMatch' });

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
  const t = useT();
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
      toast.success(t('common.passwordChanged'), t('settings.youWereSignedOutEverywhereElse'));
      reset();
      await signOut();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'INVALID_CREDENTIALS') {
          setError('currentPassword', { message: err.message });
          return;
        }
      }
      toast.error(t('settings.couldNotChangeYourPassword'), errorMessage(err));
    }
  }

  async function revokeSession(id: string) {
    setRevoking(id);
    try {
      await api.delete(`/users/me/sessions/${id}`);
      setSessions((current) => current?.filter((s) => s.id !== id) ?? null);
      toast.success(t('settings.sessionSignedOut'));
    } catch (err) {
      toast.error(t('settings.couldNotSignThatSessionOut'), errorMessage(err));
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
      toast.error(t('settings.couldNotSignOutEverywhere'), errorMessage(err));
      setSigningOutAll(false);
      setConfirmSignOutAll(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <p className="text-[13.5px] font-medium text-ink">{t('common.changePassword')}</p>
        <p className="mt-1 text-[12px] text-ink-muted">
          {t('settings.changingYourPasswordSignsOutEvery')}
        </p>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4 flex flex-col gap-4 sm:max-w-sm">
          <Field label={t('settings.currentPassword')} error={errors.currentPassword?.message && t.maybe(errors.currentPassword.message)}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} type="password" autoComplete="current-password" aria-describedby={describedBy} invalid={invalid} {...register('currentPassword')} />
            )}
          </Field>
          <Field label={t('common.newPassword')} error={errors.newPassword?.message && t.maybe(errors.newPassword.message)}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} type="password" autoComplete="new-password" aria-describedby={describedBy} invalid={invalid} {...register('newPassword')} />
            )}
          </Field>
          <Field label={t('common.confirmNewPassword')} error={errors.confirm?.message && t.maybe(errors.confirm.message)}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} type="password" autoComplete="new-password" aria-describedby={describedBy} invalid={invalid} {...register('confirm')} />
            )}
          </Field>
          <Button type="submit" variant="gold" loading={isSubmitting} className="w-fit">
            {t('common.changePassword')}
          </Button>
        </form>
      </section>

      <PinSection />

      <section className="border-t border-line-faint pt-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 basis-48">
            <p className="text-[13.5px] font-medium text-ink">{t('settings.activeSessions')}</p>
            <p className="mt-1 text-[12px] text-ink-muted">{t('settings.devicesCurrentlySignedInToYour')}</p>
          </div>
          {sessions && sessions.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-negative hover:bg-negative-soft"
              leftIcon={<LogOut className="size-3.5" />}
              onClick={() => setConfirmSignOutAll(true)}
            >
              {t('settings.signOutEverywhere')}
            </Button>
          )}
        </div>

        <ul className="mt-4 flex flex-col divide-y divide-line-faint rounded-lg border border-line">
          {(sessions ?? []).map((session) => (
            <li key={session.id} className="flex items-center gap-3 px-4 py-3">
              {isMobileUserAgent(session.userAgent) ? (
                <Smartphone aria-hidden className="size-4 shrink-0 text-ink-muted" />
              ) : (
                <Laptop aria-hidden className="size-4 shrink-0 text-ink-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-[13px] font-medium text-ink">
                  {shortUserAgent(session.userAgent)}
                  {session.isCurrent && (
                    <span className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-positive">
                      <ShieldCheck className="size-3" /> {t('settings.thisDevice')}
                    </span>
                  )}
                </p>
                <p className="truncate text-[11px] text-ink-muted">
                  {session.ipAddress ?? t('security.activity.unknownIp')}
                </p>
              </div>
              {!session.isCurrent && (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={revoking === session.id}
                  onClick={() => void revokeSession(session.id)}
                >
                  {t('common.signOut')}
                </Button>
              )}
            </li>
          ))}

          {sessions?.length === 0 && (
            <li className="px-4 py-4 text-[12.5px] text-ink-muted">{t('settings.noOtherActiveSessions')}</li>
          )}
        </ul>
      </section>

      <SecurityActivitySection />

      <DeleteAccountSection />

      <ConfirmDialog
        open={confirmSignOutAll}
        onCancel={() => setConfirmSignOutAll(false)}
        onConfirm={signOutEverywhere}
        title={t('settings.signOutEverywhere2')}
        description={t('settings.everyDeviceIncludingThisOneWill')}
        confirmLabel={t('settings.signOutEverywhere')}
        tone="danger"
        busy={signingOutAll}
      />
    </div>
  );
}
