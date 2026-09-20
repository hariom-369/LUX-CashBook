import type { WorkspaceMode } from '@khata/shared';

/**
 * Navigation (§55).
 *
 * One declaration drives the desktop sidebar, the mobile bottom bar and the command
 * palette, so the three can never disagree about what exists or what it is called.
 * `modes` is what makes Personal and Business feel like different products while
 * being one codebase.
 */
export interface NavItem {
  to: string;
  label: string;
  /** Lucide icon name, resolved at render time. */
  icon: string;
  /** Which workspace modes show this item. Omitted = both. */
  modes?: WorkspaceMode[];
  /** Pinned to the mobile bottom bar (at most four, plus the central add button). */
  mobile?: boolean;
  /** Section heading in the sidebar. */
  group: 'main' | 'money' | 'plan' | 'business' | 'system';
  description?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'LayoutDashboard', group: 'main', mobile: true, description: 'Balances, cash flow and what needs attention' },
  { to: '/transactions', label: 'Transactions', icon: 'ArrowLeftRight', group: 'main', mobile: true, description: 'Every entry, searchable and filterable' },
  { to: '/cash-book', label: 'Cash Book', icon: 'BookOpen', group: 'main', description: 'Traditional single, double and triple column views' },

  { to: '/people', label: 'People', icon: 'Users', group: 'money', mobile: true, description: 'Who owes you and who you owe' },
  { to: '/accounts', label: 'Accounts', icon: 'Wallet', group: 'money', description: 'Cash, bank, UPI, cards and wallets' },

  { to: '/budgets', label: 'Budgets', icon: 'Target', group: 'plan', description: 'Monthly limits by category' },
  { to: '/goals', label: 'Goals', icon: 'Flag', group: 'plan', description: 'What you are saving towards' },
  { to: '/recurring', label: 'Recurring', icon: 'Repeat', group: 'plan', description: 'Salary, rent, EMIs and subscriptions' },

  { to: '/petty-cash', label: 'Petty Cash', icon: 'Coins', group: 'business', modes: ['business'], description: 'Imprest float and replenishment' },
  { to: '/customers', label: 'Customers', icon: 'UserRound', group: 'business', modes: ['business'], description: 'Receivables by customer' },
  { to: '/suppliers', label: 'Suppliers', icon: 'Truck', group: 'business', modes: ['business'], description: 'Payables by supplier' },
  { to: '/daily-closing', label: 'Daily Closing', icon: 'CalendarCheck', group: 'business', modes: ['business'], description: 'Count the drawer and reconcile' },
  { to: '/month-closing', label: 'Month Closing', icon: 'CalendarRange', group: 'business', modes: ['business'], description: 'Freeze a month and file it' },

  { to: '/reports', label: 'Reports', icon: 'FileBarChart', group: 'system', mobile: true, description: 'Statements, exports and PDFs' },
  { to: '/insights', label: 'Insights', icon: 'Sparkles', group: 'system', description: 'What changed and where the money went' },
  { to: '/settings', label: 'Settings', icon: 'Settings', group: 'system', description: 'Profile, security, data and preferences' },
];

export const NAV_GROUPS: Array<{ id: NavItem['group']; label: string | null }> = [
  { id: 'main', label: null },
  { id: 'money', label: 'Money' },
  { id: 'plan', label: 'Planning' },
  { id: 'business', label: 'Business' },
  { id: 'system', label: null },
];

export function navItemsFor(mode: WorkspaceMode): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.modes || item.modes.includes(mode));
}

export function mobileNavItems(mode: WorkspaceMode): NavItem[] {
  return navItemsFor(mode).filter((item) => item.mobile);
}
