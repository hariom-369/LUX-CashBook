import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * The surface every panel in the app sits on.
 *
 * A hairline border plus a whisper of shadow, never a heavy drop shadow — depth in
 * a premium interface comes from contrast between surfaces, not from blur radius.
 */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** `flat` for dense lists and tables, `raised` for anything floating. */
  elevation?: 'flat' | 'raised';
  /** Remove internal padding when the card wraps a table or list. */
  bare?: boolean;
  interactive?: boolean;
}

export function Card({
  elevation = 'flat',
  bare = false,
  interactive = false,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-line bg-surface',
        elevation === 'flat' ? 'shadow-xs' : 'shadow-md',
        !bare && 'p-5 sm:p-6',
        interactive &&
          'cursor-pointer transition-[border-color,box-shadow,transform] duration-200 ease-[--ease-out-soft] hover:-translate-y-px hover:border-line-strong hover:shadow-sm',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  /** Small uppercase label above the title — the "statement" texture. */
  eyebrow?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function CardHeader({ title, eyebrow, description, action, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="label-eyebrow mb-2">{eyebrow}</div>}
        <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {description && (
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** A full-bleed divider inside a padded card. */
export function CardDivider({ className }: { className?: string }) {
  return <hr className={cn('-mx-5 my-5 border-0 border-t border-line-faint sm:-mx-6', className)} />;
}
