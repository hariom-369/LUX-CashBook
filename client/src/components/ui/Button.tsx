import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

/**
 * The one button in the system.
 *
 * `primary` is ink-on-paper and does the ordinary work; `gold` is reserved for the
 * single most important action on a screen. Using gold for more than one thing at a
 * time is what makes an interface look like it is shouting, so the variants are
 * named to make that choice deliberate rather than accidental.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-ink text-ink-inverse hover:bg-ink/90 active:bg-ink shadow-xs disabled:bg-ink/40',
  gold:
    'bg-gold text-white hover:bg-gold-strong active:bg-gold-strong shadow-gold disabled:bg-gold/40',
  secondary:
    'bg-surface text-ink border border-line hover:bg-sunken hover:border-line-strong active:bg-sunken',
  ghost: 'bg-transparent text-ink-secondary hover:bg-sunken hover:text-ink active:bg-sunken',
  danger: 'bg-negative text-white hover:bg-negative/90 active:bg-negative disabled:bg-negative/40',
  link: 'bg-transparent text-gold hover:text-gold-strong underline underline-offset-4 decoration-gold/40 hover:decoration-gold',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-[13px] gap-1.5 rounded-sm',
  md: 'h-11 px-5 text-sm gap-2 rounded-md',
  lg: 'h-13 px-7 text-[15px] gap-2.5 rounded-md',
  // 44px keeps every icon button at the minimum comfortable touch target.
  icon: 'size-11 p-0 rounded-md',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

/**
 * Shared class list, so a `<Link>` that should look like a button can borrow the
 * exact same styling instead of a near-copy that drifts.
 */
export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  fullWidth = false,
): string {
  return cn(
    'relative inline-flex select-none items-center justify-center whitespace-nowrap font-medium',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[--ease-out-soft]',
    'active:scale-[0.985] disabled:pointer-events-none disabled:opacity-60',
    VARIANTS[variant],
    SIZES[size],
    fullWidth && 'w-full',
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leftIcon,
    rightIcon,
    fullWidth,
    className,
    children,
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      // A loading button stays focusable but is not activatable, so a keyboard user
      // does not lose their place mid-submit.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex select-none items-center justify-center whitespace-nowrap font-medium',
        'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[--ease-out-soft]',
        'active:scale-[0.985] disabled:pointer-events-none disabled:opacity-60 disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {!loading && leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});
