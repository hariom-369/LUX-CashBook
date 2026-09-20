import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * One overlay primitive, three presentations.
 *
 * On desktop a form is a centred modal; on a phone the same form is a bottom sheet
 * you can reach with a thumb (§3, §63). Rather than build two components and let
 * them drift apart, this picks its presentation from a breakpoint — so every form
 * in the app is automatically correct on both.
 *
 * Focus handling is not optional for a dialog: focus moves in on open, is trapped
 * while open, and returns to the element that opened it on close.
 */
export type SheetSide = 'auto' | 'center' | 'bottom' | 'right';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  side?: SheetSide;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Disable dismissal while a submit is in flight. */
  busy?: boolean;
  className?: string;
}

const SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-2xl',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  side = 'auto',
  size = 'md',
  busy = false,
  className,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  const requestClose = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  useEffect(() => {
    if (!open) return;

    restoreFocusTo.current = document.activeElement as HTMLElement | null;

    // Lock the page behind the overlay without letting the layout jump sideways
    // when the scrollbar disappears.
    const { overflow, paddingRight } = document.body.style;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;

    const focusTimer = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panelRef.current)?.focus();
    }, 50);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        requestClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      );
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      window.clearTimeout(focusTimer);
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      restoreFocusTo.current?.focus?.();
    };
  }, [open, requestClose]);

  if (!open) return null;

  const isBottom = side === 'bottom';
  const isRight = side === 'right';
  const isAuto = side === 'auto';

  return createPortal(
    <div className="fixed inset-0 z-[60] flex" role="presentation">
      <div
        aria-hidden
        onClick={requestClose}
        className="animate-fade-in absolute inset-0 bg-overlay backdrop-blur-[2px]"
      />

      <div
        className={cn(
          'relative flex w-full',
          isBottom && 'items-end',
          isRight && 'justify-end',
          isAuto && 'items-end sm:items-center sm:justify-center',
          side === 'center' && 'items-center justify-center p-4',
        )}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === 'string' ? title : undefined}
          tabIndex={-1}
          className={cn(
            'relative flex max-h-[92dvh] w-full flex-col border-line bg-raised shadow-lg outline-none',
            // Bottom sheet on phones, dialog from the small breakpoint upward.
            (isAuto || isBottom) &&
              'animate-sheet-up rounded-t-2xl border-t sm:animate-rise-in sm:rounded-2xl sm:border',
            isRight && 'animate-fade-in h-full max-h-none rounded-l-2xl border-l sm:max-w-md',
            side === 'center' && 'animate-rise-in rounded-2xl border',
            isAuto && SIZES[size],
            className,
          )}
        >
          {/* Grab handle — a phone affordance, hidden once this becomes a dialog. */}
          {(isAuto || isBottom) && (
            <div aria-hidden className="mx-auto mt-3 h-1 w-9 shrink-0 rounded-full bg-line-strong sm:hidden" />
          )}

          {(title || description) && (
            <header className="flex items-start justify-between gap-4 px-5 pb-4 pt-5 sm:px-6">
              <div className="min-w-0">
                {title && (
                  <h2 className="text-balance text-[17px] font-semibold tracking-[-0.01em] text-ink">
                    {title}
                  </h2>
                )}
                {description && (
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={requestClose}
                disabled={busy}
                aria-label="Close"
                className="-mr-1.5 -mt-1 shrink-0 rounded-md p-2 text-ink-muted transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40"
              >
                <X aria-hidden className="size-4" />
              </button>
            </header>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">{children}</div>

          {footer && (
            <footer className="shrink-0 border-t border-line-faint bg-surface px-5 py-4 pb-safe sm:rounded-b-2xl sm:px-6">
              {footer}
            </footer>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
}: ConfirmDialogProps) {
  return (
    <Sheet open={open} onClose={onCancel} title={title} description={description} size="sm" busy={busy}>
      <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-11 rounded-md border border-line bg-surface px-5 text-sm font-medium text-ink transition-colors hover:bg-sunken disabled:opacity-60"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={() => void onConfirm()}
          disabled={busy}
          className={cn(
            'h-11 rounded-md px-5 text-sm font-medium text-white transition-colors disabled:opacity-60',
            tone === 'danger' ? 'bg-negative hover:bg-negative/90' : 'bg-ink text-ink-inverse hover:bg-ink/90',
          )}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
