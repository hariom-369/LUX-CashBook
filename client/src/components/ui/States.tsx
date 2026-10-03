import type { ReactNode } from 'react';
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button } from './Button';
import { ApiRequestError } from '../../lib/api';
import { useT } from '../../i18n';

/**
 * Loading, empty and error states.
 *
 * §56 asks for empty states that are useful rather than a shrug, and §57 asks for
 * every action to have all four states. Centralising them means a new screen gets
 * all of that by using one component instead of reinventing it — and reinventing it
 * is exactly how "No data found." ends up on a screen.
 */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton h-4 w-full', className)} />;
}

export function LoadingState({ label, rows = 3 }: { label?: string; rows?: number }) {
  const t = useT();
  return (
    <div role="status" aria-live="polite" aria-busy className="flex flex-col gap-3 py-2">
      <span className="sr-only">{label ? `${label}…` : t('common.loading')}</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-10 shrink-0 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/4 opacity-70" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  /** Say what to do next, never just "no data". */
  description?: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
  compact?: boolean;
  /** Heading level for the title. `h2` suits a section; a page that is only this state (404) uses `h1`. */
  titleAs?: 'h1' | 'h2';
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact = false,
  titleAs: Title = 'h2',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-10' : 'px-6 py-16',
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden
          className="mb-5 flex size-14 items-center justify-center rounded-xl border border-line bg-sunken text-ink-faint"
        >
          {icon}
        </div>
      )}
      <Title className="text-balance text-[15px] font-semibold text-ink">{title}</Title>
      {description && (
        <p className="text-balance mt-2 max-w-sm text-[13px] leading-relaxed text-ink-muted">
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

export interface ErrorStateProps {
  error?: unknown;
  title?: string;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
  /** `h1` when this state replaces the whole page (a detail page that failed to load). */
  titleAs?: 'h1' | 'h2';
}

export function ErrorState({ error, title, onRetry, className, compact, titleAs: Title = 'h2' }: ErrorStateProps) {
  const t = useT();
  const offline = error instanceof ApiRequestError && error.isOffline;
  const message =
    error instanceof ApiRequestError
      ? error.message
      : error instanceof Error && error.message
        ? error.message
        : t('ui.somethingWentWrongWhileLoadingThis');

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
    >
      <div
        aria-hidden
        className={cn(
          'mb-4 flex size-12 items-center justify-center rounded-xl border',
          offline
            ? 'border-line bg-sunken text-ink-muted'
            : 'border-negative/25 bg-negative-soft text-negative',
        )}
      >
        {offline ? <WifiOff className="size-5" /> : <AlertTriangle className="size-5" />}
      </div>

      <Title className="text-[15px] font-semibold text-ink">
        {title ?? (offline ? t('app.youReOffline') : t('ui.thatDidNotLoad'))}
      </Title>
      <p className="text-balance mt-2 max-w-sm text-[13px] leading-relaxed text-ink-muted">{message}</p>

      {error instanceof ApiRequestError && error.requestId && !offline && (
        <p className="mt-3 font-mono text-[11px] text-ink-faint">{t('ui.reference')} {error.requestId}</p>
      )}

      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-5"
          leftIcon={<RefreshCw className="size-3.5" />}
          onClick={onRetry}
        >
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}
