import { useCallback } from 'react';
import { setDateLocaleResolver } from '@khata/shared';
import { useAuthStore } from '../stores/auth.store';
import { useUiStore } from '../stores/ui.store';
import { translateServerMessage } from './serverMessages';
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

/** A module-level constant's reference to a catalogue key; render it with t(ref.key). Not a string on purpose, so an un-translated render site fails typecheck. */
export interface MessageRef {
  readonly key: MessageKey;
}

export function msg(key: MessageKey): MessageRef {
  return { key };
}

export function resolveLanguage(value: string | null | undefined): Language {
  return value && value in LANGUAGES ? (value as Language) : 'en';
}

/** Catalogue prefixes for labels that `@khata/shared` defines in English (statuses, presets, account types…). */
export type LabelGroup =
  | 'txType' | 'accountType' | 'paymentMethod' | 'relationship' | 'billKind' | 'role' | 'docType'
  | 'invoiceStatus' | 'quotationStatus' | 'stockMovement' | 'range' | 'currency' | 'goalIcon';

export function sharedLabel(language: Language, group: LabelGroup, id: string, fallback: string): string {
  const key = `${group}.${id}`;
  return key in en ? translate(language, key as MessageKey) : fallback;
}

/**
 * The language in force right now, outside React: the signed-in user's preference, or - on the
 * signed-out screens, where there is no user - the one chosen on this device.
 */
export function currentLanguage(): Language {
  const user = useAuthStore.getState().user;
  return resolveLanguage(user ? user.preferences.language : useUiStore.getState().deviceLanguage);
}

/** `t()` for code outside React (api client, background sync): follows the language in force right now. */
export function tNow(key: MessageKey, vars?: MessageVars): string {
  return translate(currentLanguage(), key, vars);
}

export function tNowPlural(base: PluralBase, count: number, vars?: MessageVars): string {
  return translatePlural(currentLanguage(), base, count, vars);
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
  const userLanguage = useAuthStore((s) => (s.user ? s.user.preferences.language : null));
  const deviceLanguage = useUiStore((s) => s.deviceLanguage);
  const language = resolveLanguage(userLanguage ?? deviceLanguage);
  const t = useCallback((key: MessageKey, vars?: MessageVars) => translate(language, key, vars), [language]);
  return Object.assign(t, {
    /** A sentence the server composed (an insight, a security-activity line, an error): translated when the catalogue recognises it, shown as written otherwise. */
    server: (text: string) => translateServerMessage(language, text),
    /** Translate a catalogue key, or pass any other text (e.g. a server message) through unchanged. */
    maybe: (text: string) => (text in en ? translate(language, text as MessageKey) : text),
    /** A label owned by `@khata/shared` (e.g. a status or range preset): translated when the catalogue has `group.id`, else the shared English text. */
    label: (group: LabelGroup, id: string, fallback: string) => sharedLabel(language, group, id, fallback),
    plural: (base: PluralBase, count: number, vars?: MessageVars) => translatePlural(language, base, count, vars),
    language,
  });
}

/**
 * Month names in dates follow the interface language. `@khata/shared`'s formatters are plain functions,
 * so they ask for the language each time they need a name - nothing to keep in sync, and nothing read
 * while this module loads (the stores import the API client, which imports this file).
 */
setDateLocaleResolver(() => currentLanguage());
