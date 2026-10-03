import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Mail, User } from 'lucide-react';
import { CURRENCIES, type AuthSessionDto } from '@khata/shared';
import { AuthLayout } from '../../layouts/AuthLayout';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Input';
import { ApiRequestError, api } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';
import { applyServerFieldErrors } from './formErrors';
import { PasswordStrength } from './PasswordStrength';
import { useT } from '../../i18n';

const schema = z.object({
  name: z.string().trim().min(1, 'auth.enterYourName').max(80, 'auth.thatNameIsTooLong'),
  email: z.string().trim().min(1, 'auth.enterYourEmailAddress').email('auth.enterAValidEmailAddress'),
  // Matches the server's policy exactly, so the client never promises something
  // the API will then reject.
  password: z.string().min(10, 'auth.useAtLeast10Characters').max(256, 'auth.thatPasswordIsTooLong'),
  currency: z.string().default('INR'),
});

type FormValues = z.infer<typeof schema>;

/** Detected from the browser so a first-time user rarely has to change it. */
function guessTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  } catch {
    return 'Asia/Kolkata';
  }
}

export function RegisterPage() {
  const t = useT();
  const navigate = useNavigate();
  const startSession = useAuthStore((s) => s.startSession);

  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '', currency: 'INR' },
  });

  const password = watch('password');

  async function onSubmit(values: FormValues) {
    setFormError(null);
    try {
      const session = await api.post<AuthSessionDto>(
        '/auth/register',
        { ...values, timeZone: guessTimeZone() },
        { skipAuth: true },
      );
      await startSession(session);
      navigate('/onboarding', { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError && applyServerFieldErrors(err, setError)) return;
      setFormError(err instanceof Error ? err.message : t('auth.couldNotCreateYourAccountPlease'));
    }
  }

  return (
    <AuthLayout
      title={t('auth.createYourAccount')}
      subtitle={t('auth.trackCashBankUpiAndWhat')}
      footer={
        <>
          {t('auth.alreadyHaveAnAccount')}{' '}
          <Link to="/login" className="font-medium text-gold underline-offset-4 hover:underline">
            {t('auth.signIn')}
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

        <Field label={t('auth.yourName')} error={errors.name?.message && t.maybe(errors.name.message)} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoComplete="name"
              placeholder={t('auth.ashaSharma')}
              leftSlot={<User aria-hidden className="size-4" />}
              aria-describedby={describedBy}
              invalid={invalid}
              {...register('name')}
            />
          )}
        </Field>

        <Field label={t('common.email')} error={errors.email?.message && t.maybe(errors.email.message)} required>
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

        <Field
          label={t('auth.password')}
          error={errors.password?.message && t.maybe(errors.password.message)}
          hint={!errors.password ? t('auth.atLeast10CharactersAShort') : undefined}
          required
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
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

        <PasswordStrength password={password} />

        <Field label={t('common.currency')} hint={t('auth.youCanAddWorkspacesInOther')}>
          {({ id }) => (
            <Select id={id} {...register('currency')}>
              {Object.values(CURRENCIES).map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.symbol} · {t.label('currency', currency.code, currency.name)} ({currency.code})
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Button type="submit" size="lg" fullWidth loading={isSubmitting} className="mt-2">
          {t('auth.createAccount')}
        </Button>

        <p className="text-center text-[12px] leading-relaxed text-ink-faint">
          {t('auth.yourFinancialDataStaysYoursExport')}
        </p>
      </form>
    </AuthLayout>
  );
}
