# Phase 5 — Verification Notes

## What shipped

**Performance / code-splitting**
- Every authenticated route in `App.tsx` is now `React.lazy()`-loaded — Reports,
  Settings, Budgets, Goals, Recurring, PettyCash, Closing pages, etc. each ship
  as their own chunk instead of inside one monolithic bundle
- `vite.config.ts` `manualChunks` separates `react`, `recharts` (`charts`, only
  needed by Dashboard/Reports) and `@tanstack/react-query` into their own vendor
  chunks
- Net effect (see build output): the shared app-shell chunk that every route
  needs on first paint is now the only large chunk (~1.1MB uncompressed /
  ~254KB gzipped); every individual screen (Reports, Settings, PersonLedger,
  CashBook, ...) loads on demand as a 1–30KB chunk

**Offline-first (§39)** — the largest gap identified after Phase 4
- `vite-plugin-pwa` in `injectManifest` mode, custom service worker at
  `client/src/sw.ts`: precaches the full app shell (35 entries, ~1.8MB),
  `NetworkFirst` for a fixed allowlist of API GET reads (dashboard, accounts,
  transactions, people, categories, cash-book, budgets, goals, reports) so the
  app has something to render offline, `StaleWhileRevalidate` for Google Fonts.
  Writes are **never** intercepted by the service worker — only the app's own
  outbox logic handles mutations, so there is exactly one place that decides
  what happens to a write, not two competing ones.
- `lib/offlineDb.ts`: an IndexedDB-backed outbox (queued mutations) and a small
  cache store, via `idb`
- `hooks/useOfflineSync.ts`: drains the outbox in creation order whenever the
  browser reports a connection (plus a 30s belt-and-braces poll for flaky
  Wi-Fi/captive portals). Each item's existing `idempotencyKey` (already part of
  the transaction engine from §51) makes replaying the queue after an
  interrupted sync safe. A permanent failure (4xx validation/business-rule
  rejection — never a network blip) is removed from the queue and surfaced to
  the user with a named toast rather than silently vanishing or retried forever.
- `QuickAddSheet`: on a network failure specifically (not any other error), the
  transaction is queued to the outbox instead of shown as an error, with a
  "saved offline — will sync automatically" toast
- **Session survival while offline** (the trickiest part, see below):
  `stores/auth.store.ts` caches the last-known session (user, workspaces,
  active workspace) via a `useAuthStore.subscribe()` that keeps the cache
  current automatically, and distinguishes "the server said no" from "the
  server is unreachable" both at initial bootstrap and for any later mid-session
  token refresh, via `ApiRequestError.isOffline`
- `OfflineBanner` (offline, or pending items queued) and `UpdateBanner`
  (`registerType: 'prompt'` — a new build is available, applied on demand,
  never a mid-session force-reload) surface state to the user
- **8 new tests** for the outbox/cache primitives (`offlineDb.test.ts`)

## Two real bugs caught by live testing, not by unit tests

1. **Offline bootstrap was logging users out.** The very thing §39 asks for —
   "keep working when the connection drops" — was broken by the most obvious
   naive implementation: both the initial session bootstrap and any mid-session
   refresh failure treated "network unreachable" identically to "your session
   ended," clearing the session and bouncing to `/login`. Fixed with the
   `isOfflineSession` flag and the cached-session fallback described above.
2. **Stale onboarding state after an offline reload.** The session cache was
   only written at login/register, not when later state changes (like
   completing onboarding) touched the same user object — so an offline reload
   after finishing onboarding incorrectly showed the onboarding flow again.
   Fixed by moving the cache write into a `useAuthStore.subscribe()` that fires
   on *any* relevant state change, rather than trusting every call site to
   remember to update it individually.

## Verified by

1. `npm test` (server) — **98/98 passing**
2. `npm test` (client) — **18/18 passing**
3. `npm run typecheck` on both workspaces — clean
4. `npm run build` (client) — succeeds; service worker builds and precaches 35
   entries
5. **Live end-to-end offline walkthrough** (Playwright against a production
   `vite preview` build, the only way the real service worker registers):
   registered and onboarded online → visited Accounts and Transactions via real
   in-app navigation (confirmed via direct Cache Storage inspection that all 5
   expected API GETs were cached: dashboard, accounts ×2 query variants,
   categories, transactions) → went offline → **reloaded the page while
   offline and the full dashboard rendered from cache**, with the offline
   banner showing → recorded a transaction through Quick Add while offline →
   confirmed it queued in the IndexedDB outbox (not sent, not lost, not shown
   as an error) → reconnected → confirmed the outbox drained to zero
   automatically with no user action → reloaded and **confirmed the
   transaction that was recorded offline is now present after being read back
   from the server** — the full offline → sync → server round trip, not just
   the parts that are easy to unit test.

   A secondary finding from that same run, not a bug: an *expense* recorded
   offline against the freshly-seeded ₹0 Cash account correctly failed to sync
   with `INSUFFICIENT_BALANCE` once back online, because cash accounts block
   going negative by design (a Phase 3 invariant). `useOfflineSync` already
   handles this correctly — the item is removed from the queue and the user is
   told plainly that entry needs to be re-entered, rather than it disappearing
   silently. This is the balance guard working as intended, not an offline-sync
   defect; the walkthrough above uses an income entry instead to isolate and
   confirm the sync mechanism itself.

## Round two: the remaining named gaps

After the offline-first work above, four items remained explicitly named as
outstanding: natural-language entry, dashboard personalization, share, and a
dedicated annual report. All four are now built, live-tested, and covered by
unit tests.

**Natural-language transaction entry (§46)** — `lib/naturalLanguageEntry.ts`,
wired into `QuickAddSheet` as a "Type it instead" field on the type-picker
step. `parseQuickEntry(text, { categories, people })` is a pure function that
guesses the transaction type from keywords (lent/borrowed/received/spent/…),
pulls the amount out while correctly skipping date/time-shaped numbers like
"5pm", resolves "today"/"yesterday", and matches a category or person name
already on file. It only ever **pre-fills** the ordinary review form — the
same screen manual entry lands on, with the original text visible for the user
to check — and never submits on its own, so a misparse costs a correction, not
a wrong transaction. 11 unit tests. Live-verified: "Received 5000 salary
yesterday" correctly produced amount ₹5,000, category "Salary", and yesterday's
date, all editable before saving.

**Dashboard drag-and-drop personalization (§64)** —
`stores/dashboardLayout.store.ts` (order + hidden widget ids, persisted to
localStorage the same way theme/privacy mode are, since this is a per-device
display preference, not financial data) plus a "Customize dashboard" mode in
`DashboardPage.tsx`. Reordering is via up/down buttons on each widget rather
than native HTML5 drag-and-drop, deliberately — native drag events have no
keyboard equivalent, and this app's accessibility posture (real focus
management, ARIA everywhere else) would be undercut by shipping a
mouse-only-friendly reorder control. Each widget can also be hidden and
restored from a tray, and a reset returns to the default layout. 8 unit tests
covering the store logic, including the case of a saved layout predating a
newly-added widget id (appended, never dropped, so an app update can't quietly
reset someone's customization). Live-verified end to end: entered edit mode,
hid a widget, reordered another, restored the hidden one, reset, exited, and
confirmed the reset layout survives a reload.

**Share (§36, §48)** — `lib/share.ts` + `components/ShareButton.tsx`. Tries
the OS share sheet first (`navigator.share`, one tap on a phone), falls back
to a small menu with an explicit WhatsApp option (a plain `wa.me` compose
link — no API key, no WhatsApp-side integration, just a prefilled message the
user still has to choose a recipient for and send themselves) and a clipboard
copy. Every caller builds its own summary text — the button itself never has
access to raw ledger data, so what gets shared is only ever what the screen
already showed the user. Wired into the person ledger page (share a balance
summary) and the new annual summary report. 7 unit tests — one of which caught
a real bug: the original `AbortError`-detection for a cancelled OS share sheet
assumed the thrown value was `instanceof Error`, which doesn't reliably hold
for a `DOMException` across environments, so a cancelled share was being
mis-reported as a failure. Fixed to check `.name` directly.

**Annual Summary report** — a sixth Reports tab
(`features/reports/ReportsPage.tsx`), This Year / Last Year toggle, built
entirely from the existing `/reports/category` endpoint (no server changes,
so it carries the same 98/98-passing guarantee as every other report): total
income, total expenses, net savings, savings rate, and top income/expense
categories for the selected year, with a "Share summary" button. Live-verified
with seeded income and expense data — correct totals, correct savings rate,
and the shared clipboard text matched what was on screen exactly.

**A quick accessibility win** — a skip-to-content link and a focusable
`#main-content` landmark were added to `AppShell.tsx`. Auditing the existing
shared primitives (`Sheet`, `Toast`, `Field`/`Input`, `Sidebar`) while doing
this found they already had real focus trapping, `aria-live` regions, label
associations, and `:focus-visible` styling from earlier phases — that
groundwork was already solid, not neglected.

## Known follow-ups — still not done

- **Client test coverage, while much better (44 tests, up from 18), is still
  thin relative to the server** (98 tests). The additions this round covered
  every new piece of pure logic (parser, share utility, layout store) plus
  `<Money>`; most existing feature pages and forms still have no dedicated
  tests.
- **No dedicated accessibility/responsive audit pass across every screen** —
  the shared primitives are confirmed solid and a skip link was added, but a
  systematic per-screen pass (keyboard-only walkthroughs, screen-reader
  testing beyond spot checks) hasn't been done.
- A few of the 14 named reports in §27 still don't have a fully separate view
  from the general Reports/Insights pages (the Annual Summary now covers the
  yearly case; some narrower named reports remain folded into existing tabs).
- The chunk-size warning is down to one shared app-shell chunk
  (~255KB gzipped); further reduction would mean splitting code needed on the
  very first authenticated paint, which trades one request for several with no
  real payload win — left as is.
