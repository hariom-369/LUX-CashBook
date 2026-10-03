import { create } from 'zustand';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface OfflineState {
  pendingCount: number;
  /** Queued items a replay found a stale-revision conflict on — kept until the user resolves them (§Phase 15). */
  conflictCount: number;
  syncing: boolean;
  lastSyncError: string | null;
  /** True for a few seconds right after a sync finishes cleanly — the transient "Synced" state, before settling to the quiet "Online" one. */
  justSynced: boolean;
  setPendingCount: (count: number) => void;
  setConflictCount: (count: number) => void;
  setSyncing: (syncing: boolean) => void;
  setLastSyncError: (error: string | null) => void;
  setJustSynced: (justSynced: boolean) => void;
}

/** How many queued writes are waiting, whether any need the user's attention, and whether a sync is in flight right now. */
export const useOfflineStore = create<OfflineState>((set) => ({
  pendingCount: 0,
  conflictCount: 0,
  syncing: false,
  lastSyncError: null,
  justSynced: false,
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setConflictCount: (conflictCount) => set({ conflictCount }),
  setSyncing: (syncing) => set({ syncing }),
  setLastSyncError: (lastSyncError) => set({ lastSyncError }),
  setJustSynced: (justSynced) => set({ justSynced }),
}));

export type SyncState = 'offline' | 'syncing' | 'needs_attention' | 'synced' | 'online';

/**
 * The five-way sync state §Phase 15 asks for, derived rather than stored —
 * there is exactly one source of truth for each ingredient (`navigator.onLine`,
 * the sync-in-progress flag, how many items are queued/conflicted), so this
 * can never drift out of sync with itself the way a sixth, independently-set
 * "current state" field could.
 */
export function useSyncState(): SyncState {
  const online = useOnlineStatus();
  const syncing = useOfflineStore((s) => s.syncing);
  const conflictCount = useOfflineStore((s) => s.conflictCount);
  const justSynced = useOfflineStore((s) => s.justSynced);

  if (!online) return 'offline';
  if (syncing) return 'syncing';
  if (conflictCount > 0) return 'needs_attention';
  if (justSynced) return 'synced';
  return 'online';
}
