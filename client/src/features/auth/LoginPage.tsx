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

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const applySession = useAuthStore((s) => s.applySession);

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
      applySession(session);

      // Return the user to wherever they were headed before the redirect.
      const target = (location.state as { from?: string } | null)?.from;
      navigate(session.user.onboardingCompleted ? (target ?? '/') : '/onboarding', { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError && applyServerFieldErrors(err, setError)) return;
      setFormError(err instanceof Error ? err.message : 'Could not sign you in. Please try again.');
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your ledger."
      footer={
        <>
          New here?{' '}
          <Link to="/register" className="font-medium text-gold underline-offset-4 hover:underline">
            Create an account
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

        <Field label="Email" error={errors.email?.message}>
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

        <Field label="Password" error={errors.password?.message}>
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
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
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
            Forgot password?
          </Link>
        </div>

        <Button type="submit" size="lg" fullWidth loading={isSubmitting} className="mt-1">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
