import { forwardRef, useEffect, useState } from 'react';
import { currencyMeta, formatMoney, parseMoney } from '@khata/shared';
import { cn } from '../../lib/cn';
import { useCurrency } from '../../hooks/useCurrency';

export interface MoneyInputProps {
  /** Value in minor units, or null when the field is empty. */
  value: number | null;
  onChange: (amountMinor: number | null) => void;
  currency?: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  name?: string;
  'aria-describedby'?: string;
  onBlur?: () => void;
  className?: string;
  /** The oversized variant used by the quick-add sheet (§45). */
  size?: 'md' | 'hero';
}

/**
 * Amount entry.
 *
 * Three decisions make this feel fast rather than fussy:
 *
 *  1. **The user's raw text is preserved while they type.** Reformatting on every
 *     keystroke moves the caret and makes editing the middle of a number
 *     infuriating, so grouping is applied on blur, not during entry.
 *  2. **Parsing is permissive.** "1,25,000", "₹1234", "5k" and "1.5L" all work,
 *     because that is what people actually type on a phone.
 *  3. **The value handed upward is always integer minor units** (invariant I1).
 *     A float never exists, not even transiently.
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  {
    value,
    onChange,
    currency,
    placeholder,
    autoFocus,
    disabled,
    invalid,
    id,
    name,
    onBlur,
    className,
    size = 'md',
    ...aria
  },
  ref,
) {
  const fallbackCurrency = useCurrency();
  const code = currency ?? fallbackCurrency;
  const meta = currencyMeta(code);

  const [text, setText] = useState(() =>
    value === null ? '' : formatMoney(value, { currency: code, symbol: false, compactDecimals: true }),
  );
  const [focused, setFocused] = useState(false);

  // Follow external changes (duplicate, edit, form reset) — but never while the
  // field has focus, or we would fight the user's caret.
  useEffect(() => {
    if (focused) return;
    setText(
      value === null ? '' : formatMoney(value, { currency: code, symbol: false, compactDecimals: true }),
    );
  }, [value, code, focused]);

  function handleChange(raw: string) {
    setText(raw);
    if (raw.trim() === '') {
      onChange(null);
      return;
    }
    const parsed = parseMoney(raw, code);
    // An unparseable partial entry ("1." mid-typing) leaves the last good value in
    // place rather than clearing it out from under the user.
    if (parsed !== null) onChange(parsed);
  }

  function handleBlur() {
    setFocused(false);
    const parsed = parseMoney(text, code);
    if (parsed === null) {
      setText(value === null ? '' : formatMoney(value, { currency: code, symbol: false, compactDecimals: true }));
    } else {
      onChange(parsed);
      setText(formatMoney(parsed, { currency: code, symbol: false, compactDecimals: true }));
    }
    onBlur?.();
  }

  const hero = size === 'hero';

  return (
    <div className={cn('relative flex items-center', className)}>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute left-0 flex items-center justify-center text-ink-muted',
          hero ? 'w-10 text-[28px] font-medium' : 'w-10 text-[15px]',
        )}
      >
        {meta.symbol}
      </span>
      <input
        ref={ref}
        id={id}
        name={name}
        // `inputMode="decimal"` gives phones a numeric keypad with a decimal point,
        // while `type="text"` keeps grouping characters and shorthand typable.
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        placeholder={placeholder ?? (hero ? '0' : '0.00')}
        value={text}
        onFocus={() => setFocused(true)}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={handleBlur}
        className={cn(
          'tabular w-full rounded-md border bg-sunken pl-10 pr-3.5 text-ink placeholder:text-ink-faint',
          'transition-[border-color,background-color,box-shadow] duration-150 ease-[--ease-out-soft]',
          'focus:border-gold focus:bg-surface focus:outline-none focus:ring-4 focus:ring-[--k-gold-ring]',
          'disabled:cursor-not-allowed disabled:opacity-60',
          hero
            ? 'h-16 text-[32px] font-semibold tracking-[-0.02em]'
            : 'h-11 text-[15px] font-medium',
          invalid ? 'border-negative focus:border-negative' : 'border-line',
        )}
        {...aria}
      />
    </div>
  );
});
