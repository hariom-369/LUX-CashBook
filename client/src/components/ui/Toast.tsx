import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, TriangleAlert, Undo2, X, XCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss. `0` keeps it until dismissed. */
  duration?: number;
  action?: ToastAction;
}

interface ToastRecord extends Required<Pick<ToastOptions, 'title' | 'tone' | 'duration'>> {
  id: string;
  description?: string;
  action?: ToastAction;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  /**
   * The undo toast (§43). Deliberately longer-lived than a normal toast, because
   * the whole point is that the user has time to notice and react.
   */
  undo: (title: string, onUndo: () => void | Promise<void>, description?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, { icon: ReactNode; accent: string }> = {
  success: { icon: <CheckCircle2 className="size-4" />, accent: 'text-positive' },
  error: { icon: <XCircle className="size-4" />, accent: 'text-negative' },
  warning: { icon: <TriangleAlert className="size-4" />, accent: 'text-warning' },
  info: { icon: <Info className="size-4" />, accent: 'text-info' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = crypto.randomUUID();
      const record: ToastRecord = {
        id,
        title: options.title,
        description: options.description,
        tone: options.tone ?? 'info',
        duration: options.duration ?? 4500,
        action: options.action,
      };

      // Cap the stack: a burst of failures should not bury the screen.
      setToasts((current) => [...current.slice(-3), record]);

      if (record.duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), record.duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      dismiss,
      success: (title, description) => toast({ title, description, tone: 'success' }),
      error: (title, description) => toast({ title, description, tone: 'error', duration: 7000 }),
      undo: (title, onUndo, description) =>
        toast({
          title,
          description,
          tone: 'info',
          duration: 9000,
          action: { label: 'Undo', onClick: onUndo },
        }),
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/*
        `aria-live="polite"` announces each toast without interrupting whatever the
        user is doing. Bottom-centre on mobile keeps it clear of the thumb reach
        area; bottom-right on desktop keeps it out of the content column.
      */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 p-4 pb-safe sm:inset-x-auto sm:right-0 sm:items-end"
      >
        {toasts.map((item) => (
          <ToastItem key={item.id} toast={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  const tone = TONE_STYLES[toast.tone];

  return (
    <div
      role="status"
      className={cn(
        'animate-rise-in pointer-events-auto flex w-full max-w-sm items-start gap-3',
        'rounded-lg border border-line bg-raised p-3.5 shadow-lg',
      )}
    >
      <span aria-hidden className={cn('mt-0.5 shrink-0', tone.accent)}>
        {tone.icon}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold leading-snug text-ink">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">{toast.description}</p>
        )}
      </div>

      {toast.action && (
        <button
          type="button"
          onClick={() => {
            void toast.action!.onClick();
            onDismiss();
          }}
          className="flex shrink-0 items-center gap-1 rounded-sm px-2 py-1 text-[12px] font-semibold text-gold transition-colors hover:bg-gold-soft"
        >
          {toast.action.label === 'Undo' && <Undo2 aria-hidden className="size-3.5" />}
          {toast.action.label}
        </button>
      )}

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-sm p-1 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>.');
  return context;
}
