import { CloudOff, RefreshCw } from 'lucide-react';
import { cn } from '../lib/cn';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useOfflineStore } from '../stores/offline.store';

/**
 * The one visible sign that offline mode exists at all (§39).
 *
 * Shown whenever there's something worth telling the user: the connection is
 * down, or there's queued work that hasn't reached the server yet — even after
 * reconnecting, until the queue actually drains. Silent the rest of the time; a
 * banner that's always there stops meaning anything.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  const pendingCount = useOfflineStore((s) => s.pendingCount);
  const syncing = useOfflineStore((s) => s.syncing);

  if (online && pendingCount === 0) return null;

  return (
    <div
      role="status"
      className={cn(
        'sticky top-0 z-50 flex items-center justify-center gap-2 px-4 py-2 text-[12.5px] font-medium text-white pt-safe',
        online ? 'bg-gold' : 'bg-ink',
      )}
    >
      {online ? (
        <>
          <RefreshCw aria-hidden className={cn('size-3.5', syncing && 'animate-spin')} />
          {syncing
            ? `Syncing ${pendingCount} offline ${pendingCount === 1 ? 'entry' : 'entries'}…`
            : `${pendingCount} offline ${pendingCount === 1 ? 'entry' : 'entries'} waiting to sync`}
        </>
      ) : (
        <>
          <CloudOff aria-hidden className="size-3.5" />
          You're offline
          {pendingCount > 0 && ` — ${pendingCount} entr${pendingCount === 1 ? 'y' : 'ies'} saved on this device`}
        </>
      )}
    </div>
  );
}
