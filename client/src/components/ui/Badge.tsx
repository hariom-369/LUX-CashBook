import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type BadgeTone = 'neutral' | 'positive' | 'negative' | 'warning' | 'info' | 'gold' | 'outline';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-soft text-ink-secondary',
  positive: 'bg-positive-soft text-positive',
  negative: 'bg-negative-soft text-negative',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
  gold: 'bg-gold-soft text-gold-strong',
  outline: 'border border-line text-ink-muted',
};

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: ReactNode;
  className?: string;
  /** Uppercase micro-caps, for the "Internal Transfer" style markers (§11). */
  eyebrow?: boolean;
}

export function Badge({ children, tone = 'neutral', icon, className, eyebrow = false }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-2 py-0.5 font-medium',
        eyebrow ? 'text-[10px] uppercase tracking-[0.07em]' : 'text-[11.5px]',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** A coloured dot used in legends and category chips. */
export function Dot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: color }}
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
    />
  );
}
