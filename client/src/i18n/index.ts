import { useCallback } from 'react';
import { useAuthStore } from '../stores/auth.store';
import { en, type MessageKey } from './messages/en';
import { hi } from './messages/hi';

/**
 * Translations — an in-house, typed message catalogue (docs/FEATURE_ROADMAP.md,
 * decision 6). No dependency: `Intl.PluralRules` covers plurals, and money,
 * numbers and dates already go through `@khata/shared`'s formatters.
 *
 * English is the source of truth (`messages/en.ts`); keys are type-checked, so a
 * typo is a compile error rather than a blank label. New UI uses `t()`; the rest
 * of the app's strings move over in Phase 14.
 */

export const LANGUAGES = { en: 'English', hi: 'हिन्दी' } as const;
export type Language = keyof typeof LANGUAGES;

const CATALOGUES: Record<Language, Partial<Record<MessageKey, string>>> = { en, hi };

export type MessageVars = Record<string, string | number>;

/** Keys that have plural forms: `base.one` / `base.other`. */
type PluralBase = {
  [K in MessageKey]: K extends `${infer Base}.other` ? (`${Base}.one` extends MessageKey ? Base : never) : never;
}[MessageKey];

export function resolveLanguage(value: string | null | undefined): Language {
  return value && value in LANGUAGES ? (value as Language) : 'en';
}

/** Look up a message, fill `{placeholders}`, and fall back to English. */
export function translate(language: Language, key: MessageKey, vars?: MessageVars): string {
  const template = CATALOGUES[language][key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** Pick the plural form for `count` using the language's own plural rules. */
export function translatePlural(language: Language, base: PluralBase, count: number, vars?: MessageVars): string {
  const category = new Intl.PluralRules(language).select(count);
  const key = (`${base}.${category}` in en ? `${base}.${category}` : `${base}.other`) as MessageKey;
  return translate(language, key, { count, ...vars });
}

/**
 * `const t = useT(); t('install.action')` — follows the signed-in user's
 * language preference, English otherwise.
 */
export function useT() {
  const language = resolveLanguage(useAuthStore((s) => s.user?.preferences.language));
  const t = useCallback((key: MessageKey, vars?: MessageVars) => translate(language, key, vars), [language]);
  return Object.assign(t, {
    plural: (base: PluralBase, count: number, vars?: MessageVars) => translatePlural(language, base, count, vars),
    language,
  });
}
