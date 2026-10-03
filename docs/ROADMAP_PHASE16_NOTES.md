# Phase 16 — Final Polish — Verification Notes

> **Status: partial.** Shortcuts, bulk actions, demo workspace, an accessibility
> audit-and-fix pass and measured list rendering shipped; report caching and
> analytics are **deferred pending your decision**, contextual help and settings
> reorganisation are **not built because no spec exists**, loan interest and
> investments are deferred. The first paragraph and "Not done" lists below are
> history; **Update 3** at the end is the current state.

## What shipped

**Global keyboard shortcuts** (`lib/shortcuts.ts`, `components/KeyboardShortcuts.tsx`,
mounted in `AppShell`): `n` opens Quick Add, `g` then `d/t/p/a/b/r/s` navigates,
`?` opens a help sheet listing them. Never fires while typing in an
input/textarea/select/contenteditable or with Ctrl/Cmd/Alt held (so it can't
collide with the command palette's Ctrl/Cmd+K or browser shortcuts). The
resolution logic is a pure function with 3 unit tests.

## Not done (all still open)

- Accessibility audit (keyboard-only and screen-reader walkthroughs) — the
  one item that most needs a person with a screen reader; not something I
  can claim from automated checks.
- List virtualisation, report caching, bulk actions with confirmation.
- Settings-centre reorganisation, demo workspace UI (the `isDemo` flag and
  wipe exist server-side), contextual help.
- Opt-in, amount-free product analytics.
- Loan interest and investment holdings (both P3; interest explicitly waits
  on an agreed accounting treatment).
- The two larger named gaps from earlier phases remain: Phase 14's ~100-file
  string migration and Phase 15's ~88 non-queueing mutation call sites.

## Verification

Typecheck and lint clean; client tests 89/89 (3 new). Not exercised in a
browser — the dev server points at live Atlas.

## Update — more items shipped

- **Bulk actions with confirmation** — "Select" on the transactions list,
  checkbox rows, a count bar, and a confirm dialog before "Delete selected".
  Deletes go through the offline-capable path; the result toast reports
  deleted / queued / skipped counts. Component-tested.
- **Demo workspace** — `POST /workspaces/demo` builds a flagged sample
  workspace entirely through the ordinary services (so it can't hold a state
  the engine couldn't produce); a second one is refused; it deletes without
  typing its name. Server-tested incl. a clean integrity check. Button in
  Settings → Workspaces.
- **Automated accessibility lint** — `eslint-plugin-jsx-a11y` recommended
  rules as errors on all client components. It found real issues, fixed: the
  offline banner was a `button` with `role="status"`. Two deliberate
  deviations are documented in `eslint.config.mjs` (autofocus inside focus-
  trapping modal sheets; label association through our design-system inputs).
  This is the automated half only — no screen-reader walkthrough was done.

Deliberately not done, with reasons: **report caching** (a cache is a second
derived store that can go stale against the ledger; it needs a design
decision first — see Update 2), **list virtualisation** (pages
are server-paginated at 50, so no measured need yet), **analytics** (an
opt-in pipeline with no sink would be fake), **loan interest** (waits on an
agreed accounting treatment), **investment holdings**, **settings
reorganisation**, **contextual help**, and the **manual screen-reader and
keyboard-only audit**.

## Update 2 — current state, and the two decisions that are needed

Nothing new was built for Phase 16 in this pass beyond what is already listed
(the work went into completing Phase 14). Two items are **explicitly deferred
and need a decision from you before anyone builds them**:

### 1. Report caching — decision required

Why it is not done: reports are currently computed on request from the
ledger, with no cache. The only cached figures are the account/person balances
(`cachedBalanceMinor`), which `ARCHITECTURE.md` I2 allows only as an always
recomputable read optimisation. A report cache would be a second derived store
that can disagree with the ledger, and the engine has many write paths
(transactions, edits, deletes/undo, imports, restores, closings, recurring
postings, reconciliation) that would each have to invalidate it. That is a
design decision about an invariant, not an implementation detail.

What is needed from you, in order:

1. **Is there a measured problem?** Which report, how long, on how much data.
   Without a number, caching is speculative.
2. **Which trade-off do you accept?** (a) keep reports computed on request and optimise the
   queries/indexes instead — no invariant changes; (b) cache with
   *workspace-wide version-stamp invalidation* (any ledger write bumps a
   per-workspace counter; cached reports are keyed by it, so they can never be
   served stale) — this keeps correctness but needs a hook in every write
   path; (c) time-based cache — **not recommended**, it would show wrong
   numbers.
3. Where the cache may live (in-process vs Redis) — relevant to the
   single-instance assumption in `DEPLOYMENT.md`.

### 2. Product analytics — decision required

Why it is not done: an opt-in pipeline needs somewhere to send events, and
there is none; building the client half alone would be a fake feature.

What is needed from you:

1. **Destination:** self-hosted collector, a third-party SaaS (which one), or
   a table in the existing database.
2. **Consent model:** opt-in toggle in Settings → Preferences (default off,
   stored on the user), and whether signed-out visitors are tracked at all
   (recommended: no).
3. **Event schema:** the roadmap says "no amounts". Please confirm the
   allow-list — recommended: event name, screen, app version, language, and a
   random per-install id; **never** amounts, names, descriptions, account or
   category names, or workspace ids. Retention period and a "delete my
   analytics" path should be agreed too.

Nothing has been added to the client or server for either item.

### Still open, unchanged

Manual accessibility audit (keyboard-only and screen-reader walkthroughs — the
automated jsx-a11y lint is not that), list virtualisation (pages are
server-paginated at 50; no measured need), settings-centre reorganisation,
contextual help, loan interest (waits on an agreed accounting treatment) and
investment holdings.

## Update 3 — accessibility audit, measured list rendering, and what was not built

### Accessibility audit

**Method — and its limit.** There was no screen reader in this environment, so
this is **not a screen-reader audit**. What was done instead, in headless
Chromium against a throw-away in-memory database:

- **axe-core (WCAG 2.0/2.1/2.2 A+AA and best-practice rules)** on every route,
  at 1280 px light, 1280 px dark and 390 px light, for a personal and a business
  workspace (target size and contrast included); then again with each dialog,
  sheet, overlay and form open (Quick Add and its form, command palette with
  results, shortcut help, workspace switcher, account menu, mobile drawer,
  transaction detail, the bulk-delete confirmation, every "add/new" sheet, and
  the business forms) and on the person / group / account detail pages.
- **A scripted keyboard walkthrough:** first Tab stop and skip link, focus entering
  and being trapped in sheets and the drawer, Escape, focus returning to the
  opener, combobox semantics, focus-ring visibility, reflow at 320 px.
- **Manual reading of the code** for live regions, headings, landmarks and labels.

After the fixes below, the final run reported **zero axe violations** on all of
the above (results in the verification section). That is evidence the markup is
well-formed and the contrast passes — it is not proof a screen-reader user can
complete the tasks.

**Found and fixed**

| Finding | Fix |
|---|---|
| Text contrast failed AA across the app: `ink-faint` 2.2–2.5:1, `ink-muted` ~4.0, gold text/buttons 3.3–3.6, soft-tinted chips ~3.7–4.4 (dark mode: faint 3.0) | Re-stepped tokens in `styles/theme.css` (light and dark) and the chart-axis colour; the gold accent is slightly deeper. Buttons use `text-ink-inverse` instead of `text-white` (white on the light dark-mode gold was ~2.2:1; the offline banner's white-on-ink was invisible in dark mode). |
| `<html lang>` stayed `en` in Hindi, so a screen reader would read Hindi with an English voice | `useDocumentLanguage` |
| No page title or announcement on navigation (single-page app) | `document.title` per page (`"Security · Settings · Khata"`, also for signed-out screens) and a polite, non-focus-stealing `RouteAnnouncer`; `lib/pageTitle.ts` |
| Command palette was a `listbox` with no combobox input | Full combobox: `role=combobox`, `aria-controls`, `aria-activedescendant`, labelled groups, options out of the Tab order, a polite result count |
| Workspace switcher: unnamed `listbox` containing a link; mode shown as raw English | Disclosure pattern; Escape returns focus; translated mode names; client-side `Link` |
| Report charts (net-worth trend, forecast) had no text equivalent | `ChartTextAlternative` visually-hidden data table (masked in privacy mode); pictures `aria-hidden` |
| Three filter `<select>`s, four sr-only file inputs, goal icon buttons, invoice/quotation line-item fields, a nested control inside selectable rows had no accessible name or were nested-interactive | Named / hidden / restructured; selectable rows are `role=checkbox` |
| `<dl>` markup invalid on the dashboard; `<header>` in every sheet created extra banner landmarks; empty/error states skipped from h1 to h3; no `<main>` on signed-out screens; top bar duplicated each page's h1; dashboard and 404 had no h1 | Fixed; page-level error states are `h1` |
| Required fields were marked only with a visual asterisk | Visually-hidden "(required)" in every field label |
| Wide tables could not be scrolled by keyboard | `ScrollRegion` (labelled, focusable) around 9 tables |
| Privacy toggles claimed both a changing label and `aria-pressed` | Label only |
| Quick Add's disabled Save gave no reason | A described hint: "To save, fill in: Amount." |
| Two untranslated strings the earlier scan could not see ("You're offline", the offline API message); a duplicate-React-key bug in the new palette groups | Fixed; the scanner now handles apostrophes; the regression test fails on the old key |

**Still open (be explicit):** a real screen-reader pass (NVDA/JAWS with
Chrome/Firefox, VoiceOver on iOS/macOS, TalkBack); 200–400 % zoom and text-spacing
overrides; Windows high-contrast / forced-colours; reduced-motion behaviour of
the sheets; voice-control labels; accessibility of the generated PDFs; the toast
region nests `role=status` inside an `aria-live` container, which some readers
announce twice (not reproduced here); the loading skeletons carry no h1.

### List virtualisation — measured, then decided per list

Measured on a production build with 5,001 transactions in one account, headless
Chromium, desktop and with 4× CPU throttling (a mid-range phone):

| Screen | Before | After |
|---|---|---|
| Transactions (server-paginated, 50/page) | 1,034 nodes · 212 ms · 0 long tasks (phone: 254 ms) | unchanged — **pagination is sufficient; nothing added** |
| Cash Book, a month (~100 rows) | 99 ms (phone 784 ms) | unchanged |
| Cash Book, a year of 5,019 rows | 65,339 nodes · 2.05 s desktop · **15.4 s phone**, 2.9 s blocked, 59/120 scroll frames dropped | 3,594 nodes · 0.74 s desktop · **2.6 s phone**, 0 dropped frames |
| Account ledger (capped at 500 rows) | not measured at the cap (500 rows is ~5× a month's worth); left as is | — |

So there **was** a measured need, but only for the Cash Book, where the response
is unbounded. It now draws 250 rows at a time with "Show 250 more / Show all N"
and a note that totals and the closing balance cover every entry (they come from
the server, so no figure changed). This is progressive rendering, not a
windowing library: no dependency, and once expanded everything is in the DOM for
find-in-page. The response itself is still unbounded; server-side paging of the
cash book would change how the running balance is carried and is not done.
Figures are from a development machine, not production hardware.

### Contextual help — not built

The only specification is one table row ("Help / education · P2 · Low · Medium ·
Phase 16"). There is no design for where help lives, what it says, who writes it
or how it is translated, and inventing a help system was ruled out.
**Decision needed:** the scope (per-screen "?" popovers? an empty-state tip? a
help page?), who owns the copy, and whether it must be in Hindi from day one.

### Settings reorganisation — not built

Likewise one table row ("Settings centre reorganisation · P2 · Low · Medium"), no
target structure. Reviewed as-is: seven tabs (Profile, Preferences, Payees,
Notifications, Security, Data, Workspaces); the tab rail and every tab are
keyboard-reachable and axe-clean. Observations for whoever writes the spec (not
acted on): Payees is a data directory rather than a preference; Workspaces holds
demo creation and member management beside plain settings; the language setting
sits among date/number formats. **Decision needed:** the desired grouping, and
whether the URLs (`/settings/payees`, …) must stay stable — they can be
bookmarked or linked from push notifications.

### Unchanged and still deferred

Report caching and product analytics (Update 2 — still need your decision), loan
interest (needs an agreed accounting treatment), investment holdings (no
accounting model specified), and broader offline creation (a verified
server-side idempotency key on every create endpoint is the prerequisite; only
Quick Add carries one). Nothing in this pass changed offline behaviour.

### Verification

See "Update 3 — verification results" at the end of this file.

## Update 3 — verification results

Run after the last code change:

| Check | Result |
|---|---|
| `npm run typecheck` | passes |
| `npm run lint` | 0 errors, 0 warnings |
| Server tests | 302 passed |
| Client tests | 174 passed (115 at the start of this pass; new: page titles, route announcer, document language, palette combobox and group keys, chart text alternatives, headings/landmarks/labels via axe in jsdom, TopBar, line-item labels, Quick Add hint, Cash Book progressive rendering, selectable rows) |
| `npm run build` | passes |
| `i18n:scan` | 0 remaining |
| Browser (production build, in-memory database) | zero axe violations on every route in desktop-light, desktop-dark and mobile-light, personal and business; zero on every opened dialog/sheet/overlay and on the three detail pages; keyboard walkthrough passes (its one remaining "FAIL" is an obsolete probe that expected an error alert from a Save button that is now disabled and described instead) |

One console line, `Failed to load resource: net::ERR_FAILED`, appeared in the
dialog sweeps and was not investigated (it does not break a page; likely a
blocked external request in the sandbox).

axe-core was added as a client dev dependency for the jsdom structural tests
(`src/test/axe.ts`). The browser audit scripts live outside the repository.

## Update 4 — accessibility follow-ups and the rate-limiter

**Closed**
- *Toast double announcement.* Each toast sat in a `role=status` inside an
  `aria-live` container. The container is now the only live region
  (`Toast.test.tsx`).
- *Forced colours (Windows high contrast).* A forced-colours block in
  `styles/theme.css`, plus an edge on filled buttons and chips
  (`forced-colors:border`), keeps controls and the (text-backed) progress bars
  visible. Emulated in Chromium (`forcedColors: active`): button edge present,
  screens legible.
- *Reduced motion.* Emulated; the Quick Add sheet closes at once.
- *Text spacing (WCAG 1.4.12)* and *zoom reflow*: the standard spacing overrides
  were injected on Daily Money, Transactions, Preferences, Reports and Organise
  and nothing was clipped; the same screens, Daily Money included, have no horizontal
  scroll at 640 px (200 %) and 320 px (400 %).
- *Language-switcher and the new screens* are axe-clean (0 violations) at both
  widths, light theme.

**Authentication rate-limiter / refresh — confirmed and fixed.** The suspected
NAT problem was real: the limiters were keyed by IP for any request that had
not yet been authenticated by the time the limiter ran, so every user behind
one NAT/office/mobile-carrier address shared one bucket, and page-load token
refreshes drained it. Limiters now key on the *verified* bearer token
(`u:<sub>`), falling back to the IP only when there is none; an unverifiable
token gets no special treatment (cannot be used to dodge the IP limit). Tests
in `rateLimitKey.test.ts`.

**Still open (nothing here can be closed from a headless run):** a real
screen-reader pass (NVDA/JAWS, VoiceOver, TalkBack); voice-control labels
(label-in-name was not checked this round); accessibility of the
generated PDFs; real-device testing. **Still blocked on a decision:** report
caching, product analytics (Update 2), contextual help and the settings
reorganisation (Update 3) — none has a specification to implement safely.

### Final verification (2026-10-03)

| Check | Result |
|---|---|
| Server tests | 36 files, **397/397** passed |
| Client tests | 36 files, **309/309** passed (one heavy 600-row Cash Book test needed a 30 s timeout under parallel load; it passes alone in ~2 s) |
| `npm run typecheck` (shared, server, client) | 0 errors |
| `eslint .` | 0 errors, 0 warnings |
| `npm run build` (client + server) | succeeds |
| `i18n:scan` | 0 remaining |
| Production boot with no secrets (`NODE_ENV=production`, empty `MONGODB_URI`/JWT vars) | refuses with a clear configuration error; no in-memory fallback |
| Browser, in-memory DB, 1280×800 and 390×844 | Daily Money / Quick Entry / palette / Hindi / forced-colours / reduced-motion / text-spacing / zoom script: 44/44 at each width, 0 console errors. Tags, rules, suggestion, reimbursement, report builder, offline create (exactly once), household masking: 30/30 at each width, 0 console errors. axe: 0 violations on every screen checked |
| `npm audit --omit=dev` | 3 advisories (sharp, nodemailer: high; csv-parse: moderate) — see `SECURITY.md`; not upgraded |

Never run against the Atlas database: every server test uses the in-process
replica set and every browser run used `MONGODB_URI=` (confirmed from the boot
log each time).


### After the dependency remediation (2026-10-03)

Server **404/404** (37 files; +7 hostile-CSV tests), client **312/312** (37 files;
+3 for the attachment-link fix), typecheck 0 errors, lint clean, `i18n:scan` 0,
client and server builds succeed, `npm audit --omit=dev`: **0 advisories**
(6 development-tooling advisories remain — see `SECURITY.md`). Browser run of
upload / email / CSV flows at 1280 px and 390 px: 28/28 each, 0 console errors.
It also found and fixed a real bug unrelated to the upgrades: attachment links
were requested as `/api/v1/api/v1/...`, so thumbnails never rendered and
attachment downloads failed (`apiPath` in `lib/api.ts`).
