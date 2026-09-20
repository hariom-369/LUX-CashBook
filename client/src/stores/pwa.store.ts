import { create } from 'zustand';

interface PwaState {
  updateAvailable: boolean;
  applyUpdate: (() => void) | null;
  setUpdateAvailable: (available: boolean, applyUpdate?: () => void) => void;
}

/** A new service-worker version has finished downloading and is ready to take over. */
export const usePwaStore = create<PwaState>((set) => ({
  updateAvailable: false,
  applyUpdate: null,
  setUpdateAvailable: (updateAvailable, applyUpdate) => set({ updateAvailable, applyUpdate: applyUpdate ?? null }),
}));
