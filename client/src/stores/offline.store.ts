import { create } from 'zustand';

interface OfflineState {
  pendingCount: number;
  syncing: boolean;
  lastSyncError: string | null;
  setPendingCount: (count: number) => void;
  setSyncing: (syncing: boolean) => void;
  setLastSyncError: (error: string | null) => void;
}

/** How many queued writes are waiting, and whether a sync is in flight right now. */
export const useOfflineStore = create<OfflineState>((set) => ({
  pendingCount: 0,
  syncing: false,
  lastSyncError: null,
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setSyncing: (syncing) => set({ syncing }),
  setLastSyncError: (lastSyncError) => set({ lastSyncError }),
}));
