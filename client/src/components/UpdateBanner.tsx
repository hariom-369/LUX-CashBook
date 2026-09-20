import { Sparkles } from 'lucide-react';
import { usePwaStore } from '../stores/pwa.store';
import { Button } from './ui/Button';

/** A new build is cached and ready — refresh on the user's terms, not the SW's. */
export function UpdateBanner() {
  const updateAvailable = usePwaStore((s) => s.updateAvailable);
  const applyUpdate = usePwaStore((s) => s.applyUpdate);

  if (!updateAvailable) return null;

  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom,0px)+12px)] z-[90] flex justify-center px-4 lg:bottom-6">
      <div className="animate-rise-in flex items-center gap-3 rounded-lg border border-line bg-raised px-4 py-3 shadow-lg">
        <Sparkles aria-hidden className="size-4 shrink-0 text-gold" />
        <p className="text-[13px] text-ink-secondary">A new version of Khata is ready.</p>
        <Button size="sm" variant="gold" onClick={() => applyUpdate?.()}>
          Refresh
        </Button>
      </div>
    </div>
  );
}
