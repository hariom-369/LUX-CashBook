import { cn } from '../../lib/cn';

/**
 * The mark.
 *
 * A ledger rule with a gold line above it — a book opened flat, read as a monogram.
 * Drawn as inline SVG with `currentColor` so it inherits ink in both themes and
 * needs no second asset for dark mode.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={cn('size-8', className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1" y="1" width="30" height="30" rx="8.5" className="fill-ink" />
      <path d="M9 11.5h14" stroke="var(--k-gold)" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 16.5h14M9 21h9" className="stroke-ink-inverse" strokeWidth="1.6" strokeLinecap="round" opacity="0.75" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="font-display text-[19px] font-semibold tracking-[-0.01em] text-ink">Khata</span>
          <span className="mt-1 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
            Cash Book
          </span>
        </span>
      )}
    </span>
  );
}
