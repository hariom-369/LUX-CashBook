import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/brand/Logo';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { useT } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentMeta';

/**
 * The signed-out frame.
 *
 * A two-column split: the form on the left, a quiet editorial panel on the right
 * that disappears below `lg`. The panel is not decoration — it is where the product
 * says what it is to someone who has not signed up yet, which is the only moment
 * that pitch is useful.
 */
export interface AuthLayoutProps {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  useDocumentTitle(title);
  const t = useT();
  return (
    <div className="flex min-h-dvh bg-canvas px-safe">
      <div className="flex w-full flex-col px-5 pb-10 pt-safe sm:px-8 lg:w-[54%] lg:px-16">
        <header className="flex h-20 shrink-0 items-center justify-between gap-4">
          <Link to="/login" aria-label={t('layout.khataHome')}>
            <Logo />
          </Link>
          <LanguageSwitcher />
        </header>

        <main className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-[400px] py-8">
            <h1 className="text-balance text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-2.5 text-[14px] leading-relaxed text-ink-muted">{subtitle}</p>
            )}

            <div className="mt-8">{children}</div>

            {footer && <div className="mt-7 text-[13.5px] text-ink-muted">{footer}</div>}
          </div>
        </main>
      </div>

      <aside
        aria-hidden
        className="relative hidden flex-1 overflow-hidden border-l border-line bg-surface lg:block"
      >
        {/* A single soft gold wash. One gradient, low opacity — enough to feel warm,
            not enough to look like a template. */}
        <div
          className="absolute inset-0 opacity-[0.55]"
          style={{
            background:
              'radial-gradient(120% 80% at 80% 0%, var(--k-gold-soft) 0%, transparent 62%)',
          }}
        />

        <div className="relative flex h-full flex-col justify-between p-16">
          <div />

          <div className="max-w-md">
            <p className="label-eyebrow mb-6 text-gold">{t('layout.builtForDailyUse')}</p>
            <p className="text-balance font-display text-[34px] font-medium leading-[1.25] tracking-[-0.02em] text-ink">
              {t('layout.everyBalanceYouSeeTracesBack')}
            </p>
            <p className="mt-6 text-[14.5px] leading-relaxed text-ink-muted">
              {t('layout.aCashBookAPersonalLedger')}
            </p>
          </div>

          <dl className="grid grid-cols-3 gap-8 border-t border-line pt-8">
            {[
              [t('layout.ledger'), t('layout.doubleEntryAccurate')],
              [t('layout.offline'), t('layout.worksWithoutSignal')],
              [t('layout.yours'), t('layout.exportEverythingAnytime')],
            ].map(([term, detail]) => (
              <div key={term}>
                <dt className="text-[13px] font-semibold text-ink">{term}</dt>
                <dd className="mt-1 text-[12px] leading-relaxed text-ink-muted">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    </div>
  );
}
