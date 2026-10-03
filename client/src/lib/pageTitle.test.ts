import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '../config/navigation';
import { en } from '../i18n/messages/en';
import { hi } from '../i18n/messages/hi';
import { pageTitleKeys } from './pageTitle';

describe('pageTitleKeys (§Phase 16 — page titles for screen readers)', () => {
  it('names the dashboard for the root path', () => {
    expect(pageTitleKeys('/')).toEqual(['nav.dashboard']);
  });

  it('names a top-level page, including its detail pages', () => {
    expect(pageTitleKeys('/transactions')).toEqual(['nav.transactions']);
    expect(pageTitleKeys('/cash-book')).toEqual(['nav.cash-book']);
    expect(pageTitleKeys('/people/64f0c1')).toEqual(['nav.people']);
  });

  it('adds the settings tab, and ignores an unknown tab', () => {
    expect(pageTitleKeys('/settings')).toEqual(['nav.settings']);
    expect(pageTitleKeys('/settings/security')).toEqual(['nav.settings', 'settings.tab.security']);
    expect(pageTitleKeys('/settings/nonsense')).toEqual(['nav.settings']);
  });

  it('reports an unknown path as the not-found page, not the previous one', () => {
    expect(pageTitleKeys('/nope')).toEqual(['app.thatPageDoesnTExist']);
  });

  it('resolves every navigation item, and every key has English and Hindi text', () => {
    for (const item of NAV_ITEMS) {
      const keys = pageTitleKeys(item.to);
      expect(keys, item.to).not.toEqual(['app.thatPageDoesnTExist']);
      for (const key of keys) {
        expect(key in en, key).toBe(true);
        expect(key in hi, key).toBe(true);
      }
    }
    expect(pageTitleKeys('/notifications')).toEqual(['settings.tab.notifications']);
  });
});
