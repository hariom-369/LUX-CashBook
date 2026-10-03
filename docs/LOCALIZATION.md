# Localization

How Khata's in-house translation system works, and how to add a language
beyond English and Hindi — Gujarati, Marathi, Bengali, Tamil, Telugu,
Kannada, Malayalam, Punjabi, or any other.

## How it works

No i18n library — `client/src/i18n/` is a small, typed message catalogue
(docs/FEATURE_ROADMAP.md, decision 6):

- `messages/en.ts` is the **source of truth**. Every key the app can ever
  display is defined here first, as `'area.thing': 'The English text'`.
  TypeScript types every key (`MessageKey`), so a typo in a component is a
  compile error, not a silently blank label.
- `messages/<lang>.ts` (e.g. `hi.ts`) is `Partial<Record<MessageKey, string>>`
  — it only needs the keys it has a translation for. Anything missing falls
  back to English automatically (`translate()` in `i18n/index.ts`), so a
  new English string never breaks an existing language's build.
- Plurals are separate keys ending in an `Intl.PluralRules` category —
  `'dataHealth.issues.one'` / `'dataHealth.issues.other'` for English and
  Hindi (both only need `one`/`other`; some languages need more categories,
  e.g. Russian's `few`). `translatePlural()` picks the right one for a
  count using the *browser's* plural rules for that language, not a
  hand-rolled count check.
- Placeholders are `{name}` inside the string, filled by `translate(lang, key, { name: value })`
  — never string concatenation in a component, which is what makes a
  sentence re-orderable in a language with different word order.
- Money, numbers and dates never go through this catalogue — they already
  go through `@khata/shared`'s own `Intl`-based formatters
  (`formatMoney`/`formatDate`/etc.), which handle locale-appropriate digit
  grouping and calendars on their own.

A component reads the current user's language with `useT()`:

```tsx
import { useT } from '../../i18n';

function Example() {
  const t = useT();
  return <button>{t('common.save')}</button>;
  // Plural: t.plural('dataHealth.issues', count)
  // Placeholder: t('security.activity.at', { device: 'Chrome', ip: '1.2.3.4' })
}
```

`useT()` reads `user.preferences.language` (set from Settings →
Preferences, which calls `PATCH /users/me/preferences` with
`{ language: 'hi' }` like any other preference) and falls back to English
for a signed-out visitor or an unset preference.

## Adding a new language

1. **Add it to `LANGUAGES`** in `client/src/i18n/index.ts`:
   ```ts
   export const LANGUAGES = { en: 'English', hi: 'हिन्दी', gu: 'ગુજરાતી' } as const;
   ```
   The key is the code `Intl.PluralRules`/`Intl.NumberFormat` expect (a
   BCP 47 language tag — `gu`, `mr`, `bn`, `ta`, `te`, `kn`, `ml`, `pa`),
   and it becomes a valid value for `preferences.language` immediately —
   the server already stores it as a plain string (`user.schema.ts`), no
   backend change needed for a new language.
2. **Create `client/src/i18n/messages/<code>.ts`**, following `hi.ts`'s
   shape exactly:
   ```ts
   import type { MessageKey } from './en';
   export const gu: Partial<Record<MessageKey, string>> = {
     'common.save': 'સેવ કરો',
     // ...
   };
   ```
   Translate as many or as few keys as you have — an incomplete catalogue
   is a safe, working state, not a build error.
3. **Register it** in the `CATALOGUES` map in `i18n/index.ts`:
   ```ts
   import { gu } from './messages/gu';
   const CATALOGUES: Record<Language, Partial<Record<MessageKey, string>>> = { en, hi, gu };
   ```
4. Pick it from Settings → Preferences → Language. That's the entire
   integration surface — no routing, build-config or server change.

## What's translated today, and what isn't

As of §Phase 14 (completed), every component's UI text comes from the
catalogue and `hi.ts` has a Hindi line for **every key `en.ts` defines**
(1,619 keys). Not localised: text that originates on the server (API error
messages, stored audit summaries such as "Signed in"), month and weekday
names produced by `@khata/shared`'s date formatters, and the signed-out
screens (the language is a signed-in user preference). See
`ROADMAP_PHASE14_NOTES.md` → "Update 3".

## Helpers beyond `t()`

- `msg('key')` — for module-level constants where no hook is available. It
  returns a `MessageRef`, not a string; render it with `t(ref.key)`. Forgetting
  to do so is a type error, not a raw key on screen.
- `t.maybe(text)` — translates the text if it is a catalogue key, otherwise
  returns it unchanged. Used for validation messages (stored as keys) and for
  server text that might be either.
- `t.label(group, id, englishFallback)` — for labels `@khata/shared` defines in
  English. Add `group.id` keys (`txType.income`, `range.last_7_days`,
  `invoiceStatus.paid`, `currency.INR`, …); an unknown id shows the shared
  English text. A test asserts every shared label has a matching English and
  Hindi key, so adding a status or preset to the shared package without
  translating it fails CI.
- `tNow(key)` / `tNowPlural(base, n)` — `t()` outside React (API client, sync
  toasts).
- `useRelativeDay()` (`i18n/relativeDay.ts`) — "Today", "Yesterday", "3 days
  ago" in the user's language.

## Keeping it complete

`npm run i18n:scan --workspace client` lists any user-visible string not
routed through the catalogue (JSX text, UI attributes, toast messages, template
literals, label-ish literals); `i18n/migration.test.ts` runs the same scan and
fails if it finds anything. To add keys in bulk, write `key|English|Hindi`
lines to a file and run `node client/tools/addkeys.cjs <file>` from `client/`
(appends to both catalogues). Intentional literals (brand, key names, example
inputs) are allow-listed in `client/tools/i18n-scan.cjs`.

## Update — server text, dates and signed-out screens

The "not localised" list above has changed: API error messages and field
errors, dashboard insights, the user's security-activity lines, month names in
every date, chart period labels, and the signed-out screens are now localised
(see `ROADMAP_PHASE14_NOTES.md` → Update 4). What remains English: stored or
sent text (notifications, push, email, PDFs, CSV headers), workspace audit
summaries, and anything people typed.

- `t.server(text)` / `translateServerMessage(language, text)` — translate a
  sentence the server composed; unknown text passes through unchanged.
- To add a server message: add the `server.*` key (English value identical to
  the server's sentence) to both catalogues. The test in
  `i18n/serverMessages.test.ts` fails until you do.
- `setDateLocaleResolver` (shared) — month names follow the active language.
- `currentLanguage()` — the signed-in preference, else the device choice made
  on the signed-out screens.
