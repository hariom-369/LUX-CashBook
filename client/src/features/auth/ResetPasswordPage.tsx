import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { AuthLayout } from '../../layouts/AuthLayout';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { api, errorMessage } from '../../lib/api';
import { PasswordStrength } from './PasswordStrength';

const schema = z
  .object({
    password: z.string().min(10, 'Use at least 10 characters.').max(256, 'That password is too long.'),
    confirm: z.string().min(1, 'Type your new password again.'),
  })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'Those passwords do not match.',
  });

type FormValues = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';

  const [showPassword, setShowPassword] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });

  async function onSubmit(values: FormValues) {
    setFormError(null);
    try {
      await api.post('/auth/reset-password', { token, password: values.password }, { skipAuth: true });
      setDone(true);
      // A moment on the confirmation, then to sign-in — the reset deliberately does
      // not sign the user in, so possession of the link alone is never a session.
      setTimeout(() => navigate('/login', { replace: true }), 2200);
    } catch (err) {
      setFormError(errorMessage(err));
    }
  }

  if (!token) {
    return (
      <AuthLayout
        title="That link isn't complete"
        subtitle="The reset link is missing its token. Request a new one and use the most recent email."
        footer={
          <Link to="/forgot-password" className="font-medium text-gold underline-offset-4 hover:underline">
            Request a new link
          </Link>
        }
      >
        <div />
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout title="Password changed" subtitle="Taking you to sign in…">
        <div className="flex items-center gap-3.5 rounded-lg border border-positive/25 bg-positive-soft p-4">
          <CheckCircle2 aria-hidden className="size-5 shrink-0 text-positive" />
          <p className="text-[13px] leading-relaxed text-ink-secondary">
            All other sessions were signed out. Sign in with your new password.
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="This link can be used once and expires in an hour.">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        {formError && (
          <div
            role="alert"
            className="rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] leading-relaxed text-negative"
          >
            {formError}{' '}
            <Link to="/forgot-password" className="font-medium underline underline-offset-4">
              Request a new link
            </Link>
          </div>
        )}

        <Field label="New password" error={errors.password?.message} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
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

        <PasswordStrength password={watch('password')} />

        <Field label="Confirm new password" error={errors.confirm?.message} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              aria-describedby={describedBy}
              invalid={invalid}
              {...register('confirm')}
            />
          )}
        </Field>

        <Button type="submit" size="lg" fullWidth loading={isSubmitting} className="mt-1">
          Change password
        </Button>
      </form>
    </AuthLayout>
  );
}
