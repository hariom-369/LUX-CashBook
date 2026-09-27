import { formatMoney, formatMoneyCompact } from '@khata/shared';
import { cn } from '../../lib/cn';
import { useCurrency } from '../../hooks/useCurrency';
import { useUiStore } from '../../stores/ui.store';

export type MoneyTone = 'auto' | 'positive' | 'negative' | 'neutral' | 'inherit';
export type MoneySize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'display';

const SIZES: Record<MoneySize, string> = {
  xs: 'text-[12px]',
  sm: 'text-[13px]',
  md: 'text-[15px]',
  lg: 'text-xl',
  xl: 'text-[28px] leading-none',
  // The hero balance. Tight tracking is what keeps a large figure from looking airy.
  display: 'text-[40px] leading-[1.05] tracking-[-0.03em] sm:text-[52px]',
};

export interface MoneyProps {
  amountMinor: number;
  currency?: string;
  tone?: MoneyTone;
  size?: MoneySize;
  /** Force a leading `+` on positive values, for transaction rows. */
  signed?: boolean;
  /** ₹1.2L instead of ₹1,25,000 — charts and dense tiles only. */
  compact?: boolean;
  /** Hide `.00` when there is no fractional part. */
  compactDecimals?: boolean;
  /** Opt out of privacy masking. Used only where a figure is not the user's money. */
  alwaysVisible?: boolean;
  className?: string;
  weight?: 'normal' | 'medium' | 'semibold';
}

/**
 * Every rupee figure in the application renders through this component.
 *
 * That is what makes two global behaviours reliable rather than aspirational:
 *
 *  • **Privacy mode (§38)** — the `sensitive` class is blurred by a single CSS rule
 *    on `<html>`, so masking cannot miss a screen that forgot to thread a prop.
 *  • **Screen readers (§59)** — the visible text may be abbreviated, so an
 *    `aria-label` carries the exact, fully-written amount — except in privacy
 *    mode, when it says "Amount hidden" and the digits are masked in the DOM too,
 *    so the value can't be read, copied or announced while it's meant to be hidden.
 */
export function Money({
  amountMinor,
  currency,
  tone = 'auto',
  size = 'md',
  signed = false,
  compact = false,
  compactDecimals = true,
  alwaysVisible = false,
  weight = 'semibold',
  className,
}: MoneyProps) {
  const fallbackCurrency = useCurrency();
  const code = currency ?? fallbackCurrency;
  // Privacy mode must hide the figure itself, not just blur it: while it's on, the
  // real value isn't in the page text, the accessible name or the tooltip.
  const masked = useUiStore((s) => s.privacyMode) && !alwaysVisible;

  const formatted = compact
    ? formatMoneyCompact(amountMinor, code)
    : formatMoney(amountMinor, { currency: code, signed, compactDecimals });
  // Same shape (sign, symbol, grouping) so the blurred figure looks unchanged,
  // but every digit replaced — even unblurred it reads as masked, never as a value.
  const text = masked ? formatted.replace(/\d/g, '•') : formatted;

  // Always exact and always unabbreviated, whatever the visible text says.
  const exact = masked ? 'Amount hidden' : formatMoney(amountMinor, { currency: code, signed });

  const resolvedTone =
    tone === 'auto' ? (amountMinor > 0 ? 'positive' : amountMinor < 0 ? 'negative' : 'neutral') : tone;

  return (
    <span
      className={cn(
        'tabular whitespace-nowrap',
        SIZES[size],
        weight === 'normal' && 'font-normal',
        weight === 'medium' && 'font-medium',
        weight === 'semibold' && 'font-semibold',
        resolvedTone === 'positive' && 'text-positive',
        resolvedTone === 'negative' && 'text-negative',
        resolvedTone === 'neutral' && 'text-ink',
        !alwaysVisible && 'sensitive',
        className,
      )}
      aria-label={exact}
      title={compact && !masked ? exact : undefined}
    >
      {text}
    </span>
  );
}

/**
 * A figure that carries no tone at all.
 *
 * Transfers and contra entries use this: they are neither income nor expense, and
 * colouring them green or red would contradict invariant I5 on screen.
 */
export function MoneyPlain(props: Omit<MoneyProps, 'tone'>) {
  return <Money {...props} tone="inherit" />;
}
