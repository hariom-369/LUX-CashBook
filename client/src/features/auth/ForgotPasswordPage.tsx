import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Mail, MailCheck } from 'lucide-react';
import { AuthLayout } from '../../layouts/AuthLayout';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { api, errorMessage } from '../../lib/api';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
});

type FormValues = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  async function onSubmit(values: FormValues) {
    setFormError(null);
    try {
      await api.post('/auth/forgot-password', values, { skipAuth: true });
      // The API answers identically for known and unknown addresses, and so does
      // this screen — anything else would leak who has an account.
      setSent(true);
    } catch (err) {
      setFormError(errorMessage(err));
    }
  }

  if (sent) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={
          <>
            If an account exists for <span className="font-medium text-ink-secondary">{getValues('email')}</span>,
            a reset link is on its way. It expires in one hour.
          </>
        }
        footer={
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 font-medium text-gold underline-offset-4 hover:underline"
          >
            <ArrowLeft aria-hidden className="size-3.5" />
            Back to sign in
          </Link>
        }
      >
        <div className="flex items-start gap-3.5 rounded-lg border border-line bg-surface p-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-gold-soft text-gold-strong">
            <MailCheck aria-hidden className="size-4" />
          </span>
          <p className="text-[13px] leading-relaxed text-ink-muted">
            Didn’t get it? Check your spam folder, then{' '}
            <button
              type="button"
              onClick={() => setSent(false)}
              className="font-medium text-gold underline-offset-4 hover:underline"
            >
              try a different address
            </button>
            .
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your email address and we'll send you a link to choose a new one."
      footer={
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 font-medium text-gold underline-offset-4 hover:underline"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        {formError && (
          <div
            role="alert"
            className="rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] text-negative"
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

        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}
