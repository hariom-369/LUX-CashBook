import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { AuthLayout } from '../../layouts/AuthLayout';
import { api, errorMessage } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';
import { useT } from '../../i18n';

type Status = 'verifying' | 'verified' | 'failed';

export function VerifyEmailPage() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [status, setStatus] = useState<Status>(token ? 'verifying' : 'failed');
  const [message, setMessage] = useState(t('auth.confirmationLinkMissingToken'));
  const setUser = useAuthStore((s) => s.setUser);
  const user = useAuthStore((s) => s.user);

  // React 18+ mounts effects twice in development. Verification tokens are
  // single-use, so a second call would report a failure for a link that just
  // worked — this guard keeps the flow honest in dev as well as production.
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    api
      .post('/auth/verify-email', { token }, { skipAuth: true })
      .then(() => {
        setStatus('verified');
        if (user) setUser({ ...user, emailVerified: true });
      })
      .catch((err) => {
        setStatus('failed');
        setMessage(errorMessage(err));
      });
  }, [token, user, setUser]);

  if (status === 'verifying') {
    return (
      <AuthLayout title={t('auth.confirmingYourEmail')} subtitle={t('auth.thisOnlyTakesAMoment')}>
        <div className="flex items-center gap-3 text-ink-muted">
          <Loader2 aria-hidden className="size-5 animate-spin text-gold" />
          <span className="text-[13.5px]">{t('auth.checkingYourConfirmationLink')}</span>
        </div>
      </AuthLayout>
    );
  }

  if (status === 'verified') {
    return (
      <AuthLayout
        title={t('auth.emailConfirmed')}
        subtitle={t('auth.yourAddressIsVerifiedSoPassword')}
        footer={
          <Link to="/" className="font-medium text-gold underline-offset-4 hover:underline">
            {t('auth.goToYourDashboard')}
          </Link>
        }
      >
        <div className="flex items-center gap-3.5 rounded-lg border border-positive/25 bg-positive-soft p-4">
          <CheckCircle2 aria-hidden className="size-5 shrink-0 text-positive" />
          <p className="text-[13px] leading-relaxed text-ink-secondary">
            {t('auth.youReAllSetNothingElse')}
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t('auth.thatLinkDidnTWork')}
      subtitle={t('auth.confirmationLinksExpireAfterAnHour')}
      footer={
        <Link to="/settings" className="font-medium text-gold underline-offset-4 hover:underline">
          {t('auth.sendANewConfirmationEmail')}
        </Link>
      }
    >
      <div className="flex items-start gap-3.5 rounded-lg border border-negative/25 bg-negative-soft p-4">
        <XCircle aria-hidden className="mt-px size-5 shrink-0 text-negative" />
        <p className="text-[13px] leading-relaxed text-ink-secondary">{message}</p>
      </div>
    </AuthLayout>
  );
}
