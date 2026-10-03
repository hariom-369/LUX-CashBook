import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Mail } from 'lucide-react';
import type { AuthSessionDto } from '@khata/shared';
import { AuthLayout } from '../../layouts/AuthLayout';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { ApiRequestError, api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';
import { applyServerFieldErrors } from './formErrors';
import { useT } from '../../i18n';

const schema = z.object({
  email: z.string().trim().min(1, 'auth.enterYourEmailAddress').email('auth.enterAValidEmailAddress'),
  password: z.string().min(1, 'auth.enterYourPassword'),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const startSession = useAuthStore((s) => s.startSession);

  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  async function onSubmit(values: FormValues) {
    setFormError(null);
    try {
      const session = await api.post<AuthSessionDto>('/auth/login', values, { skipAuth: true });
      await startSession(session);

      // Return the user to wherever they were headed before the redirect.
      const target = (location.state as { from?: string } | null)?.from;
      navigate(session.user.onboardingCompleted ? (target ?? '/') : '/onboarding', { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError && applyServerFieldErrors(err, setError)) return;
      setFormError(err instanceof Error ? err.message : t('auth.couldNotSignYouInPlease'));
    }
  }

  return (
    <AuthLayout
      title={t('auth.welcomeBack')}
      subtitle={t('auth.signInToYourLedger')}
      footer={
        <>
          {t('auth.newHere')}{' '}
          <Link to="/register" className="font-medium text-gold underline-offset-4 hover:underline">
            {t('auth.createAnAccount')}
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        {formError && (
          <div
            role="alert"
            className="rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] leading-relaxed text-negative"
          >
            {formError}
          </div>
        )}

        <Field label={t('common.email')} error={errors.email?.message && t.maybe(errors.email.message)}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              leftSlot={<Mail aria-hidden className="size-4" />}
              aria-describedby={describedBy}
              invalid={invalid}
              {...register('email')}
            />
          )}
        </Field>

        <Field label={t('auth.password')} error={errors.password?.message && t.maybe(errors.password.message)}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••••"
              aria-describedby={describedBy}
              invalid={invalid}
              rightSlot={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  className="pointer-events-auto rounded-sm p-1 text-ink-muted transition-colors hover:text-ink"
                >
                  {showPassword ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
                </button>
              }
              {...register('password')}
            />
          )}
        </Field>

        <div className="-mt-1 flex justify-end">
          <Link
            to="/forgot-password"
            className="text-[13px] font-medium text-ink-muted underline-offset-4 transition-colors hover:text-gold hover:underline"
          >
            {t('auth.forgotPassword')}
          </Link>
        </div>

        <Button type="submit" size="lg" fullWidth loading={isSubmitting} className="mt-1">
          {t('auth.signIn')}
        </Button>
      </form>
    </AuthLayout>
  );
}
