import type { MessageKey } from '../i18n/messages/en';

/** First path segments the authenticated shell routes, mapped to their catalogue title. */
const SEGMENT_TITLES: Record<string, MessageKey> = {
  today: 'nav.today',
  transactions: 'nav.transactions',
  'cash-book': 'nav.cash-book',
  people: 'nav.people',
  groups: 'nav.groups',
  accounts: 'nav.accounts',
  budgets: 'nav.budgets',
  goals: 'nav.goals',
  recurring: 'nav.recurring',
  bills: 'nav.bills',
  calendar: 'nav.calendar',
  documents: 'nav.documents',
  invoices: 'nav.invoices',
  quotations: 'nav.quotations',
  projects: 'nav.projects',
  inventory: 'nav.inventory',
  'petty-cash': 'nav.petty-cash',
  customers: 'nav.customers',
  suppliers: 'nav.suppliers',
  'daily-closing': 'nav.daily-closing',
  'month-closing': 'nav.month-closing',
  reports: 'nav.reports',
  insights: 'nav.insights',
  assistant: 'nav.assistant',
  notifications: 'settings.tab.notifications',
  settings: 'nav.settings',
};

const SETTINGS_TABS: Record<string, MessageKey> = {
  profile: 'settings.tab.profile',
  preferences: 'settings.tab.preferences',
  payees: 'settings.tab.payees',
  organise: 'settings.tab.organise',
  notifications: 'settings.tab.notifications',
  security: 'settings.tab.security',
  data: 'settings.tab.data',
  workspaces: 'settings.tab.workspaces',
};

/**
 * The catalogue keys that name the page at `pathname`, most general first
 * (`['nav.settings', 'settings.tab.security']`), for the document title and the
 * route announcement. Unknown paths resolve to the "page doesn't exist" title so a
 * 404 is never announced as the page before it.
 */
export function pageTitleKeys(pathname: string): MessageKey[] {
  const [first, second] = pathname.split('/').filter(Boolean);
  if (!first) return ['nav.dashboard'];
  const title = SEGMENT_TITLES[first];
  if (!title) return ['app.thatPageDoesnTExist'];
  if (first === 'settings') {
    const tab = second ? SETTINGS_TABS[second] : undefined;
    return tab ? [title, tab] : [title];
  }
  return [title];
}
