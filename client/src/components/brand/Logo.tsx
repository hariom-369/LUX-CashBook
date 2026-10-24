import { cn } from '../../lib/cn';
import { useT } from '../../i18n';

/**
 * The mark.
 *
 * VELORA's gold wallet on black (`public/brand/velora-mark.png`, also the source of the
 * favicon and install icons), with the same rounded-square shape and default size the
 * previous drawn mark had, so every place that shows it lays out exactly as before.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src="/brand/velora-mark.png"
      alt=""
      aria-hidden
      draggable={false}
      className={cn('size-8 shrink-0 rounded-[27%] object-cover', className)}
    />
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  const t = useT();
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="font-display text-[19px] font-semibold tracking-[-0.01em] text-ink">VELORA</span>
          <span className="mt-1 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
            {t('brand.subtitle')}
          </span>
        </span>
      )}
    </span>
  );
}
