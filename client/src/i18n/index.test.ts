import { describe, expect, it } from 'vitest';
import { resolveLanguage, translate, translatePlural } from './index';
import { en } from './messages/en';
import { hi } from './messages/hi';

describe('translations', () => {
  it('reads English from the source catalogue', () => {
    expect(translate('en', 'common.save')).toBe('Save');
  });

  it('uses Hindi where a translation exists and falls back to English where it does not', () => {
    expect(translate('hi', 'common.save')).toBe('सहेजें');
    expect(hi['security.activity.title']).toBeUndefined();
    expect(translate('hi', 'security.activity.title')).toBe(en['security.activity.title']);
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
