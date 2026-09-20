import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'khata.dashboardLayout';

async function freshStore() {
  // The store reads localStorage once at module-init time, so each test needs a
  // fresh module instance to see a fresh (or seeded) localStorage state.
  vi.resetModules();
  const mod = await import('./dashboardLayout.store');
  return mod.useDashboardLayoutStore;
}

beforeEach(() => {
  localStorage.clear();
});

describe('useDashboardLayoutStore', () => {
  it('defaults to the full widget order with nothing hidden', async () => {
    const useStore = await freshStore();
    const state = useStore.getState();
    expect(state.hidden).toEqual([]);
    expect(state.order).toContain('monthSummary');
    expect(state.order).toContain('insights');
  });

  it('moveWidget swaps a widget with its neighbour and persists the change', async () => {
    const useStore = await freshStore();
    const before = useStore.getState().order;
    const [first, second] = before;

    useStore.getState().moveWidget(first!, 'down');

    const after = useStore.getState().order;
    expect(after[0]).toBe(second);
    expect(after[1]).toBe(first);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.order).toEqual(after);
  });

  it('moveWidget is a no-op at the boundary rather than wrapping around', async () => {
    const useStore = await freshStore();
    const before = useStore.getState().order;

    useStore.getState().moveWidget(before[0]!, 'up');
    expect(useStore.getState().order).toEqual(before);

    const lastId = before[before.length - 1]!;
    useStore.getState().moveWidget(lastId, 'down');
    expect(useStore.getState().order).toEqual(before);
  });

  it('toggleHidden adds and then removes a widget from the hidden set', async () => {
    const useStore = await freshStore();
    useStore.getState().toggleHidden('quickActions');
    expect(useStore.getState().hidden).toContain('quickActions');

    useStore.getState().toggleHidden('quickActions');
    expect(useStore.getState().hidden).not.toContain('quickActions');
  });

  it('reset restores the default order and clears hidden widgets', async () => {
    const useStore = await freshStore();
    const defaultOrder = useStore.getState().order;

    useStore.getState().moveWidget(defaultOrder[0]!, 'down');
    useStore.getState().toggleHidden('insights');
    expect(useStore.getState().order).not.toEqual(defaultOrder);
    expect(useStore.getState().hidden).toContain('insights');

    useStore.getState().reset();
    expect(useStore.getState().order).toEqual(defaultOrder);
    expect(useStore.getState().hidden).toEqual([]);
  });

  it('appends a newly-added widget id to a saved layout instead of resetting it', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ order: ['insights', 'monthSummary'], hidden: ['payables'] }),
    );
    const useStore = await freshStore();
    const state = useStore.getState();

    // The two saved ids keep their saved (customised) relative order...
    expect(state.order.slice(0, 2)).toEqual(['insights', 'monthSummary']);
    // ...and every widget id not in the saved layout is appended, not dropped.
    expect(state.order).toContain('cashFlow');
    expect(state.order).toContain('transactions');
    expect(state.hidden).toEqual(['payables']);
  });

  it('falls back to defaults when localStorage holds corrupt JSON', async () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    const useStore = await freshStore();
    const state = useStore.getState();
    expect(state.hidden).toEqual([]);
    expect(state.order.length).toBeGreaterThan(0);
  });

  it('editing mode is a plain UI flag, off by default', async () => {
    const useStore = await freshStore();
    expect(useStore.getState().editing).toBe(false);
    useStore.getState().setEditing(true);
    expect(useStore.getState().editing).toBe(true);
  });
});
