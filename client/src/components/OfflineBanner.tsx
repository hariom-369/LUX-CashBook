import { useState } from 'react';
import { AlertTriangle, Check, CloudOff, RefreshCw } from 'lucide-react';
import { cn } from '../lib/cn';
import { useOfflineStore, useSyncState } from '../stores/offline.store';
import { ConflictDialog } from './ConflictDialog';
import { useT } from '../i18n';

/**
 * The one visible sign that offline mode exists at all (§39, extended §Phase 15).
 *
 * Five states, derived in `offline.store.ts#useSyncState` from one source of
 * truth per ingredient — Offline, Syncing, Needs attention, Synced (a brief
 * confirmation) and Online (quiet, nothing shown). "Needs attention" is the
 * one state the user must act on: tapping it opens `ConflictDialog`, which is
 * the only place a queued offline edit that conflicts with someone else's
 * change ever gets resolved — never silently here.
 */
export function OfflineBanner() {
  const t = useT();
  const state = useSyncState();
  const pendingCount = useOfflineStore((s) => s.pendingCount);
  const conflictCount = useOfflineStore((s) => s.conflictCount);
  const [reviewing, setReviewing] = useState(false);

  if (state === 'online') return null;

  return (
    <>
      <div
        role="status"
        className={cn(
          'sticky top-0 z-50 flex w-full items-center justify-center gap-2 px-4 py-2 text-[12.5px] font-medium text-ink-inverse pt-safe',
          BANNER_TONE[state],
        )}
      >
        {state === 'offline' && (
          <>
            <CloudOff aria-hidden className="size-3.5" />
            {t('app.youReOffline')}
            {pendingCount > 0 && ` — ${t.plural('offline.savedOnDevice', pendingCount)}`}
          </>
        )}
        {state === 'syncing' && (
          <>
            <RefreshCw aria-hidden className="size-3.5 animate-spin" />
            {t.plural('offline.syncing', pendingCount)}
          </>
        )}
        {state === 'needs_attention' && (
          <>
            <AlertTriangle aria-hidden className="size-3.5" />
            {t.plural('sync.conflict', conflictCount)}
            <button type="button" onClick={() => setReviewing(true)} className="rounded-sm underline underline-offset-2 hover:no-underline">
              {t('app.review')}
            </button>
          </>
        )}
        {state === 'synced' && (
          <>
            <Check aria-hidden className="size-3.5" />
            {t('app.everythingIsSynced')}
          </>
        )}
      </div>

      <ConflictDialog open={reviewing} onClose={() => setReviewing(false)} />
    </>
  );
}

const BANNER_TONE: Record<Exclude<ReturnType<typeof useSyncState>, 'online'>, string> = {
  offline: 'bg-ink',
  syncing: 'bg-gold',
  needs_attention: 'bg-negative',
  synced: 'bg-positive',
};
