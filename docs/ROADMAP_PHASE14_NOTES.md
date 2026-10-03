# Phase 14 — Hindi and Localisation — Verification Notes

Scope: [`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md#phase-14--hindi-and-localisation-p2),
"extract every remaining string into the catalogue from Phase 1, translate
to Hindi, add a language switcher, and document how to add Gujarati,
Marathi, Bengali, Tamil, Telugu, Kannada, Malayalam or Punjabi."

> **Status: UI string migration complete; known localisation gaps remain.**
> The sections below are the history, in order. "What's deliberately not done"
> and "Known follow-ups" describe the *first* pass and are superseded by
> **Update 3 — migration completed**, at the end of this file, which also lists
> what is still not localised.

## What shipped

**A real language switcher.** Settings → Preferences now has a working
"Language" row (`PreferencesSettings.tsx`), saving to the same
`preferences.language` field the server has accepted since Phase 1
(`PATCH /users/me/preferences`) — the one piece of plumbing that existed on
the server but had no UI to reach it until now. Every component already
migrated to `useT()` picks up the change immediately; nothing migrated yet
stays in English until it is.

**Full Hindi parity with the existing catalogue.** `hi.ts` had translations
for only 6 of the English catalogue's ~90 keys before this phase (the
module's own comment said "Full coverage is Phase 14"); every key `en.ts`
defines as of this phase now has a Hindi line — verified by a test that
iterates every English key and asserts a Hindi one exists
(`i18n/index.test.ts`), replacing a now-obsolete test that had asserted the
*opposite* (that a specific key was deliberately untranslated) — that
assertion would have started failing the moment real coverage improved,
which is exactly what happened and what the test now protects going
forward.

**`docs/LOCALIZATION.md`** — the explicitly requested "document how to add
[other languages]" deliverable: how the catalogue/fallback/plural system
works, and the exact four-step recipe (add to `LANGUAGES`, create
`messages/<code>.ts`, register it in `CATALOGUES`, done — no server change,
no build-config change) for Gujarati, Marathi, Bengali, Tamil, Telugu,
Kannada, Malayalam, Punjabi, or any other language.

## What's deliberately not done

**The roadmap's actual ask — "extract every remaining string" — was not
completed.** Before this phase, 8 of the client's 111 component files
called `useT()`; after it, 9 (`PreferencesSettings.tsx`, for the new
language row). The other ~100 files still have their text as plain English
string literals directly in JSX, not catalogue keys — they render in
English regardless of what a user picks in the language switcher.

This is named here rather than hidden because the honest alternative to
"fully done" was never "silently incomplete" — it was "explicitly scoped
and documented," which is what `docs/LOCALIZATION.md`'s own closing
section does. The reasons for stopping here rather than pushing through
the full migration:

- **The remaining work is enormous and mechanical, not risky-but-small.**
  Migrating one file is a low-risk, five-minute change (replace a string
  literal, add a catalogue key); migrating ~100 files in one pass is a
  very large diff across nearly the entire UI, which is a different risk
  profile — a mistake in any one of a hundred small edits (a missing key,
  a mismatched placeholder) is individually minor but collectively hard to
  review and verify by hand in one sitting.
- **No automated check exists yet for "does this file still have
  un-migrated strings."** A proper execution of this phase would start by
  building that check (e.g. an ESLint rule flagging bare JSX text in
  migrated directories), then running the migration file-by-file against
  it — a second, prerequisite piece of infrastructure this pass didn't
  build either.
- Partial coverage is already the system's designed steady state (every
  component has worked in a mix of migrated/unmigrated text since Phase 1
  introduced `useT()`), so stopping mid-migration leaves the app in a
  state the fallback mechanism already handles correctly — not a broken
  or inconsistent one.

## Security posture

No new attack surface: a language preference is a plain stored string,
rendered only through the typed catalogue (never interpolated into HTML
unescaped — React already prevents that), and the server already accepted
arbitrary values for this field since Phase 1.

## Verification

1. `npm run typecheck` — clean (shared, server, client).
2. `npm run lint` — clean, repository-wide.
3. `npm test` — client **80/80** (2 new/changed: full Hindi-parity
   assertion replacing the now-obsolete "this key stays untranslated"
   case, and a fallback-mechanism check using a synthetic key that will
   never exist in any catalogue). Server unaffected, 300/300 unchanged.
4. `npm run build` — succeeds.
5. Not verified against a live browser session — same constraint as every
   UI-only phase since Phase 11 in this session (no consent to exercise
   the real Atlas-backed dev server).

## Known follow-ups — next phase

- The ~100-file string-extraction migration is the single largest named
  gap in this entire roadmap's history so far — tracked here explicitly,
  not folded into "polish."
- An ESLint rule (or similar static check) to catch un-migrated strings in
  already-converted directories, so the migration can be done
  incrementally without regressing.
- Phase 15 (Offline sync 2.0) is next per the roadmap.

## Update — navigation migrated

The sidebar, mobile bottom bar and mobile drawer now read their labels and
group headings from the catalogue (`i18n/nav.ts#useNavLabels`, 28 `nav.*`
keys with Hindi lines), so the one piece of text on every screen follows the
language switcher. A test asserts every nav item and group has an English and
a Hindi key, so adding a nav item without translating it fails CI. Roughly
95 other component files are still plain English; that remainder is
unchanged and still the largest open item.

## Update 2 — Quick Add and Settings

The Quick Add type picker (title, prompt, six entry types with hints) and the
Settings page (title, subtitle, seven section tabs) now use the catalogue,
with Hindi lines; the existing parity test covers them. Still English: the
rest of Quick Add's detail form, the dashboard cards, and roughly 90 other
component files.

## Update 3 — migration completed

**Result.** 104 of the client's 113 component files now read their text from
the catalogue (the other nine have no user-visible text). The catalogue holds
1,619 keys; every one has a Hindi line (asserted by test). Nothing about the
language-switching architecture changed: `useT()` still follows
`user.preferences.language`, English is the typed source of truth, and a key
missing from a language falls back to English.

**How it was done, and why it can be trusted.**

- A TypeScript-compiler-API codemod (`client/tools/i18n-lib.cjs`) found
  user-visible strings — JSX text, UI attributes (`aria-label`, `placeholder`,
  `title`, `label`, `hint`, …), toast/`setError` messages, template literals and
  label-ish literals in ternaries/fallbacks — and rewrote them to `t('area.key')`
  with `{placeholders}`. Hindi was written for every new key.
- **A permanent guard.** `npm run i18n:scan --workspace client` lists any
  string that is not routed through the catalogue, and
  `i18n/migration.test.ts` fails the build if the list is non-empty. It covers
  `.tsx` and `.ts`, template literals with arbitrary substitutions, and
  toast calls in hooks. Intentional literals (brand name, key names, example
  inputs, default workspace names, dynamic catalogue keys) are allow-listed in
  the scanner, not scattered through the code.
- Further guards in the same test file: no Hindi value equals its own key;
  every `{placeholder}` in English survives in Hindi; every plural base has
  `.one` and `.other` in both languages; every label `@khata/shared` owns has
  an English entry that matches it and a Hindi one (see below).

**Patterns introduced** (all in `i18n/index.ts` unless noted):

- `msg(key)` → a `MessageRef` for module-level constants (tabs, filters,
  widget metadata). It is deliberately *not* a string, so a render site that
  forgets `t(ref.key)` fails typecheck instead of showing a raw key.
- `t.maybe(text)` — translate a catalogue key, pass anything else through.
  Used for zod validation messages (stored as keys) and server text.
- `t.label(group, id, englishFallback)` — for labels the **shared package**
  owns in English (transaction types, account types, payment methods,
  relationships, bill kinds, roles, document types, invoice/quotation
  statuses, stock movements, date-range presets, currency names). The shared
  package is untouched (the server still uses those strings), so there is no
  API or data change.
- `tNow(key)` / `tNowPlural(base, n)` — `t()` for code outside React (the API
  client's fallback errors, background sync toasts, the device-name helper).
- `i18n/relativeDay.ts#useRelativeDay` — "Today / Yesterday / 3 days ago" in
  the signed-in language, falling back to the shared helper beyond a week.
- Plural-by-appending-"s" fragments were replaced by whole-sentence
  `.one`/`.other` keys (Hindi cannot be built by gluing words together).

**Found only by using the app, fixed.** Driving the app in a real browser in
Hindi showed things a static scan cannot: the top-bar page title and the
dashboard greeting were English; every shared-package label (date-range
presets, document types, invoice statuses, currency names, role names) was
English; the shortcut-help destinations were English; and the command
palette's live transaction search threw `transactions.map is not a function`
because the list endpoint returns a `Paginated` page, not an array — its unit
tests had mocked the wrong shape, which hid it. All fixed; the palette tests
now use the real response shape.

**Still not localised (deliberate or out of scope):**

- **Server-originated text** stays English: API error messages (e.g. "Cash
  would go below zero…", "This feature is available in a business
  workspace."), and stored audit-trail summaries ("Signed in", "Account
  created for …"). Translating them means either error-code → message
  mapping on the client or storing structured events — a server/data change.
- **Dates:** month names and formatted dates ("October 2026", "03 Oct 2026",
  weekday/month labels in charts and Month Closing, "12:00 PM") come from
  `@khata/shared`'s `Intl`-based formatters, which use English month names.
  Numerals and digit grouping already follow the user's number-format setting.
- **Signed-out screens** (login, register, forgot/reset password, verify
  email) are translated but follow the *signed-in* user's language, so a
  signed-out visitor always sees English; a pre-login language choice is not
  built.
- **Fragment-style sentences** survive in a few places, where a phrase is
  assembled from several keys (e.g. parts of the DataSettings import summary,
  "Add {noun}") — acceptable in Hindi for the cases checked in the browser,
  but not individually proofread.
- Hindi translations are machine-assisted first drafts. They have not had a
  native-speaker review; technical terms (EMI, UPI, CSV, PIN) are left in
  Latin script on purpose.
- Both catalogues are bundled in the main chunk (now 1.39 MB, up from 1.37 MB
  at the start of this pass); lazy-loading the Hindi catalogue per language is
  a possible later optimisation and is not done.

## Verification (final)

Typecheck, lint, client tests (115) and server tests (302) pass and the
production build succeeds; see the repository-level summary. The UI was also
driven in headless Chromium against a throw-away in-memory database (never the
Atlas database): Hindi on dashboard, Quick Add, transactions with bulk
select, offline banner, shortcut help, command palette and Settings at
1280 px and 390 px, no console errors and no horizontal overflow.

## Update 4 — the four known gaps, and what is still English

Three of the four gaps listed under "Still not localised" are closed, and the
fourth (server text) is closed for everything the UI shows from an error or an
insight.

- **Server error messages.** `ApiRequestError` now translates its message and
  each field message (`i18n/serverMessages.ts`). Fixed-wording sentences are
  looked up by their exact English text (253 `server.*` keys whose English
  value *is* the server's sentence); the few that carry a name or amount are
  matched by pattern (`error.*`, 30 `entity.*` names for "X not found").
  Anything not recognised is shown exactly as the server wrote it. **A guard
  test reads the server source** and fails when an `AppError` message is added
  without a catalogue line — it found one the first extraction missed.
- **Dashboard insights and security-activity lines** are translated the same way
  (`t.server(text)`).
- **Month names.** `@khata/shared` formatters ask the client for the language
  each time (`setDateLocaleResolver`) and use the runtime's `Intl` names, so
  Hindi shows "अक्टूबर". Chart bucket labels come from the server in English;
  the server now also sends the bucket's first day (`CashFlowPointDto.start`)
  and the client writes the label itself (`lib/bucketLabel.ts`). A raw
  browser-locale date in Petty Cash was replaced with the shared formatter.
- **Signed-out screens.** A language choice on the login/register/reset screens
  (`LanguageSwitcher`), remembered on the device (`khata.language`). A signed-in
  user's saved preference always wins over it; changing the language in
  Settings also updates the device choice so the sign-in screen matches after
  sign-out. Verified: the sign-in screen switches to Hindi without an account,
  `<html lang>` follows, and a wrong password shows a Hindi message.

**Still English (be explicit):**
- Anything the server *stores or sends* rather than answers with: notification
  titles and bodies already in the database, push payloads, emails, generated
  PDFs and CSV headers. Fixing those means localising at creation time using
  the user's language on the server — a separate, larger change.
- Workspace audit-trail summaries other than the user's own security lines
  (they are only shown in Settings → Security).
- Free text people typed (names, notes, category names) — data, not interface.
- The AM/PM suffix in times; `Intl` Hindi would also write it in Latin script.
- "Choose who this {kind} involves" passes the English transaction-type word
  through.
- Hindi is still a machine-assisted first draft: **no native-speaker review has
  been done** — including every server sentence added here.
