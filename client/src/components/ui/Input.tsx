import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * Form field shell.
 *
 * Accessibility here is structural rather than decorative (§59): the label is a
 * real `<label htmlFor>`, the error and hint are wired through `aria-describedby`,
 * and `aria-invalid` marks the field — so a screen reader announces the problem
 * with the input instead of leaving red text floating unattached.
 */
export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-[13px] font-medium text-ink-secondary">
          {label}
          {required && (
            <span aria-hidden className="ml-0.5 text-gold">
              *
            </span>
          )}
        </label>
      )}

      {children({ id, describedBy, invalid: Boolean(error) })}

      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-[12px] text-negative">
          <AlertCircle aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[12px] leading-relaxed text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL_BASE =
  'w-full rounded-md border bg-sunken px-3.5 text-[15px] text-ink placeholder:text-ink-faint ' +
  'transition-[border-color,background-color,box-shadow] duration-150 ease-[--ease-out-soft] ' +
  'focus:border-gold focus:bg-surface focus:outline-none focus:ring-4 focus:ring-[--k-gold-ring] ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  invalid?: boolean;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, leftSlot, rightSlot, className, wrapperClassName, ...props },
  ref,
) {
  const control = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL_BASE,
        'h-11',
        invalid ? 'border-negative focus:border-negative focus:ring-[--k-negative-soft]' : 'border-line',
        leftSlot && 'pl-10',
        rightSlot && 'pr-10',
        className,
      )}
      {...props}
    />
  );

  if (!leftSlot && !rightSlot) return control;

  return (
    <div className={cn('relative', wrapperClassName)}>
      {leftSlot && (
        <span className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center text-ink-muted">
          {leftSlot}
        </span>
      )}
      {control}
      {rightSlot && (
        <span className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-muted">
          {rightSlot}
        </span>
      )}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, rows = 3, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL_BASE,
        'resize-y py-2.5 leading-relaxed',
        invalid ? 'border-negative focus:border-negative' : 'border-line',
        className,
      )}
      {...props}
    />
  );
});

export interface SelectProps extends InputHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  children: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL_BASE,
        'h-11 appearance-none pr-9',
        // Inline chevron so the control matches across browsers without a wrapper.
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%237b7568' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")] bg-[length:12px] bg-[right_0.9rem_center] bg-no-repeat",
        invalid ? 'border-negative' : 'border-line',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});
