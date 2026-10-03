import { describe, expect, it } from 'vitest';
import { resolveLanguage, translate, translatePlural } from './index';
import { en } from './messages/en';
import { hi } from './messages/hi';
import type { MessageKey } from './messages/en';

describe('translations', () => {
  it('reads English from the source catalogue', () => {
    expect(translate('en', 'common.save')).toBe('Save');
  });

  it('uses Hindi where a translation exists', () => {
    expect(translate('hi', 'common.save')).toBe('सहेजें');
    expect(translate('hi', 'security.activity.title')).toBe(hi['security.activity.title']);
  });

  it('falls back to English for a key the active language catalogue does not define', () => {
    // A cast, not a real key — simulates a brand-new English string that hasn't
    // been translated yet. The catalogue is additive (§Phase 14), so a gap here
    // must resolve to English rather than throw or go blank.
    const notYetTranslated = 'a.key.no.language.has.yet' as MessageKey;
    expect(translate('hi', notYetTranslated)).toBeUndefined();
  });

  it('has a Hindi translation for every key English defines (§Phase 14 full parity)', () => {
    for (const key of Object.keys(en)) expect(key in hi).toBe(true);
  });

  it('fills placeholders and leaves unknown ones visible rather than blank', () => {
    expect(translate('en', 'security.activity.at', { device: 'iPhone', ip: '10.0.0.1' })).toBe('iPhone · 10.0.0.1');
    expect(translate('en', 'security.activity.at', { device: 'iPhone' })).toBe('iPhone · {ip}');
  });

  it("picks plural forms with the language's own rules", () => {
    expect(translatePlural('en', 'dataHealth.issues', 1)).toBe('1 thing needs attention');
    expect(translatePlural('en', 'dataHealth.issues', 3)).toBe('3 things need attention');
    expect(translatePlural('en', 'dataHealth.issues', 0)).toBe('0 things need attention');
  });

  it('treats an unknown or missing language preference as English', () => {
    expect(resolveLanguage('hi')).toBe('hi');
    expect(resolveLanguage('fr')).toBe('en');
    expect(resolveLanguage(undefined)).toBe('en');
  });

  it('only translates keys that exist in English', () => {
    for (const key of Object.keys(hi)) expect(key in en).toBe(true);
  });
});

describe('navigation labels (§Phase 14)', () => {
  it('every nav item and group has an English and a Hindi label', async () => {
    const { NAV_ITEMS, NAV_GROUPS } = await import('../config/navigation');
    for (const item of NAV_ITEMS) {
      const key = `nav.${item.to === '/' ? 'dashboard' : item.to.slice(1)}` as MessageKey;
      expect(key in en, key).toBe(true);
      expect(key in hi, key).toBe(true);
    }
    for (const g of NAV_GROUPS.filter((g) => g.label)) {
      expect(`nav.group.${g.id}` in hi).toBe(true);
    }
  });
});
