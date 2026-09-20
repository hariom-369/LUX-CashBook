import { create } from 'zustand';

/**
 * Dashboard personalization (§64).
 *
 * A per-device preference, not financial data — so it lives in localStorage next
 * to theme and privacy mode (`ui.store.ts`), never on the server. Reordering or
 * hiding a widget only changes what's shown and where; it can never touch a
 * balance or a transaction, which is what makes it safe to let people rearrange
 * freely without any of this app's usual "are you sure" friction.
 */
export const DASHBOARD_WIDGET_IDS = [
  'monthSummary',
  'cashFlow',
  'transactions',
  'quickActions',
  'receivables',
  'payables',
  'upcoming',
  'insights',
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

const STORAGE_KEY = 'khata.dashboardLayout';

interface StoredLayout {
  order: DashboardWidgetId[];
  hidden: DashboardWidgetId[];
}

function isWidgetId(value: unknown): value is DashboardWidgetId {
  return typeof value === 'string' && (DASHBOARD_WIDGET_IDS as readonly string[]).includes(value);
}

function readStoredLayout(): StoredLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { order: [...DASHBOARD_WIDGET_IDS], hidden: [] };

    const parsed = JSON.parse(raw) as Partial<StoredLayout>;
    const savedOrder = Array.isArray(parsed.order) ? parsed.order.filter(isWidgetId) : [];
    // A widget id shipped in a later release than the user's saved layout is
    // appended rather than dropping their layout back to the full default —
    // otherwise every app update would silently reset everyone's customization.
    const missing = DASHBOARD_WIDGET_IDS.filter((id) => !savedOrder.includes(id));
    const hidden = Array.isArray(parsed.hidden) ? parsed.hidden.filter(isWidgetId) : [];
    return { order: [...savedOrder, ...missing], hidden };
  } catch {
    return { order: [...DASHBOARD_WIDGET_IDS], hidden: [] };
  }
}

function writeStoredLayout(layout: StoredLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* Non-fatal: the layout simply won't persist across reloads. */
  }
}

interface DashboardLayoutState {
  order: DashboardWidgetId[];
  hidden: DashboardWidgetId[];
  editing: boolean;
  setEditing: (editing: boolean) => void;
  moveWidget: (id: DashboardWidgetId, direction: 'up' | 'down') => void;
  reorder: (order: DashboardWidgetId[]) => void;
  toggleHidden: (id: DashboardWidgetId) => void;
  reset: () => void;
}

export const useDashboardLayoutStore = create<DashboardLayoutState>((set, get) => {
  const initial = readStoredLayout();

  function persistAndSet(next: Partial<StoredLayout>) {
    const order = next.order ?? get().order;
    const hidden = next.hidden ?? get().hidden;
    writeStoredLayout({ order, hidden });
    set({ order, hidden });
  }

  return {
    order: initial.order,
    hidden: initial.hidden,
    editing: false,

    setEditing: (editing) => set({ editing }),

    moveWidget: (id, direction) => {
      const order = [...get().order];
      const index = order.indexOf(id);
      if (index === -1) return;
      const swapWith = direction === 'up' ? index - 1 : index + 1;
      if (swapWith < 0 || swapWith >= order.length) return;
      [order[index], order[swapWith]] = [order[swapWith]!, order[index]!];
      persistAndSet({ order });
    },

    reorder: (order) => persistAndSet({ order }),

    toggleHidden: (id) => {
      const hidden = get().hidden.includes(id)
        ? get().hidden.filter((h) => h !== id)
        : [...get().hidden, id];
      persistAndSet({ hidden });
    },

    reset: () => persistAndSet({ order: [...DASHBOARD_WIDGET_IDS], hidden: [] }),
  };
});
