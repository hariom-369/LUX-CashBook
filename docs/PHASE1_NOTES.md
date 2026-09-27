# Phase 1 — Truth, Safety & Foundations — Verification Notes

Scope: [`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md#phase-1--truth-safety-and-foundations-all-p0p1),
closing every S/P finding from [`PRODUCT_AUDIT.md`](PRODUCT_AUDIT.md) and laying
the four foundations (feature flags, i18n scaffold, optimistic concurrency,
tooling) later phases build on. Nothing removed, no API renamed, no existing
screen's behaviour changed except where a finding required it.

## What shipped

**Security (S-1…S-5)**
- Sign-out (and any session ending) now wipes the service worker's API cache and
  the local read cache (`lib/offlineDb.ts#wipeCachedReads`, called from
  `auth.store.ts#clear` and before every fresh `startSession`). The queued
  *outbox* is untouched and now tagged per user (`OutboxItem.userId`), so on a
  shared device one account's unsynced entries are never replayed or counted
  under another's session.
- Every `/api/v1/*` response now sends `Cache-Control: no-store`
  (`server/src/app.ts`), so financial data never lands in the browser's HTTP
  cache in the first place — belt-and-braces alongside the client-side wipe.
- `<Money>` now checks privacy mode itself: when on, digits are replaced (`•`)
  in the DOM text and `aria-label` says "Amount hidden" — not just CSS-blurred,
  so screen readers, DOM inspection and copy-paste can't read a "hidden" figure.
- CSV export/import (`server/src/lib/csv.ts`) escapes any cell starting
  `= + - @` or a tab/CR with a leading `'`, and reverses it on import — closes
  the formula-injection hole while round-tripping exactly.
- App-lock PIN: 5 wrong attempts locks PIN unlock for 15 minutes
  (`User.pinFailedAttempts` / `pinLockedUntil`); the password always still
  works. The lock screen now reads the saved PIN length and submits at the
  right digit count instead of always at 4 — a real bug (see below).
- `server/.env` no longer leaks into `vitest` (`if (!process.env.VITEST) loadDotenv()`),
  so `npm test` behaves the same on every machine regardless of local deployment
  config.

**Product integrity (P-1…P-4)**
- Notification preferences are enforced, not just stored: budget alerts, loan
  reminders and recurring-item notifications all check the relevant switch
  (and the in-app master switch) before writing a `Notification`
  (`server/src/services/notificationPolicy.ts`). Email/Push/Monthly-summary
  switches are removed from the UI until those channels exist (they did
  nothing before).
- A new **recurring-notification sweep**
  (`recurring.service.ts#raiseRecurringNotifications`) announces an
  auto-posting item `reminderDaysBefore` days ahead, and asks the user to
  confirm a remind-only item once it's due — closing the Phase 3 follow-up
  ("recurring reminders aren't surfaced in a dedicated confirm UI").
- Five backend capabilities that had no screen are now reachable: **Security
  activity** (a read-only view of the user's own audit trail — sign-ins,
  password/PIN changes), **account deletion** (password + typed `DELETE`,
  exactly as the API already required), **Data health** (on-demand integrity
  check + "recalculate balances," never touches transactions), **custom
  reminders** (bills/rent/EMI/subscription, on the Notifications page), and
  the four hidden transaction filters (tag, amount range, has-receipt,
  unsettled-loans-only).
- The app is now installable: real 192/512px and maskable icons
  (`client/public/`, generated from the existing `LogoMark`), an "Install
  Khata" menu item that only appears when the browser's install prompt is
  actually available.
- Dead code/config removed: `ComingInPhase.tsx` (unused), `ENABLE_DEV_ROUTES`
  (never read), the `seed` script (target file never existed).
- ESLint is now installed and configured (`eslint.config.mjs`) — `npm run
  lint` runs for the first time in this project's history. Fixed the (few)
  pre-existing violations it found: two literal non-breaking spaces mistaken
  for regular ones, three unused imports, one `let` that should have been
  `const`, one `&&` short-circuit ESLint needed a comment to accept.

**Foundations for later phases**
- **Feature flags** (`shared/src/features.ts`): `FEATURE_*` env vars, all off
  by default, served at `GET /api/v1/features`; `useFeature()` on the client
  treats an unloaded or unreachable flag as off, never on.
- **i18n scaffold** (`client/src/i18n/`): a typed message catalogue (English
  source, partial Hindi), `{placeholder}` filling, `Intl.PluralRules`-based
  plurals, and a `useT()` hook — used by every new Phase 1 screen so the
  pattern is established, not just documented.
- **Optimistic concurrency**: every editable financial model (Transaction,
  Account, Person, Budget, SavingsGoal, RecurringTransaction) carries `rev`,
  returned in its DTO and bumped only on a user edit
  (`server/src/lib/revision.ts#claimRevision`) — never by balance-cache
  writes, repayment allocation, or any other internal bookkeeping. An editor
  sends the `rev` it read; a mismatch is refused with `409 STALE_REVISION`
  and a plain-language message, not a silent overwrite. All five existing
  edit forms (Account, Person, Budget, Goal, Recurring) now send it. Older
  clients that omit `rev` keep exactly today's last-write-wins behaviour —
  additive, not a breaking change.

## Two real bugs caught while building this, not by a pre-existing test

1. **The PIN lock screen could never unlock a PIN longer than 4 digits.** It
   submitted the instant 4 digits were entered, always — Settings has always
   allowed 4–8. Fixed by recording the PIN's length when it's set and having
   the lock screen wait for exactly that many digits (or, for a PIN saved
   before the length was recorded, a explicit ✓ key). 4 new tests
   (`PinLockScreen.test.tsx`) reproduce the original bug first, then confirm
   the fix.
2. **Every boolean query flag and several env vars used `z.coerce.boolean()`**,
   which is `Boolean(value)` — so `?includeDone=false`, exactly as the client
   sends it, meant `true`. This silently broke "hide completed reminders,"
   "hide inactive accounts," "hide read notifications," and (in `env.ts`)
   made `COOKIE_CROSS_SITE=false` and `ENABLE_SCHEDULER=false` no-ops. Fixed
   with a shared strict boolean parser (`server/src/lib/boolean.ts` /
   `middleware/validate.ts#queryBoolean`) that only accepts
   true/false/1/0/yes/no/on/off and refuses to boot or serve on anything else.
   9 regression tests across `tests/env.test.ts` and the new
   `tests/queryflags.test.ts`.

## A finding surfaced by this work, not yet fixed

- **Transactions have no in-app edit form at all** — only delete, restore and
  duplicate. The server's `updateTransaction` (and its new `rev` support) is
  fully built and tested, but nothing in the client calls it. Out of scope
  for this pass (it's a new UI surface, not a fix to something broken);
  flagged for Phase 2 alongside Quick Entry work.

## Verified by

1. `npm run typecheck` — clean (shared, server, client).
2. `npm run lint` — clean, repository-wide, for the first time.
3. `npm test` — **237/237 passing** (server 171, up from 122; client 66, up
   from 44), including 49 new server tests for this phase's findings
   (security headers, CSV escaping, PIN lockout, security-activity isolation,
   storage cleanup on account deletion, notification-preference enforcement,
   feature flags including per-workspace overrides, boolean query flags,
   optimistic concurrency across all six resources including a real
   concurrent-request race, and the `rev` backfill script) and 22 new client
   tests (privacy masking, the PIN-length bug, feature-flag fallback safety
   and the auth-header wiring fix, the translation catalogue).
4. `npm run build` — succeeds; service worker precaches 44 entries including
   the new icons; main chunk gzip size (~258KB) unchanged from Phase 5's
   baseline.
5. All server tests run against the in-process MongoDB replica set only — no
   step in this phase touched a real database.

## Self-correction: asked "is it fully complete?", checked, it wasn't

Before closing this phase I re-read my own Phase 1 "Build" list against what
was actually built and found three real gaps:

1. **Per-workspace feature-flag overrides were never built** — decision 5 and
   the Phase 1 database-impact row both promised `FeatureFlag` overrides on
   `Workspace`; only the global `FEATURE_*` env defaults existed.
2. **Three promised documents didn't exist** — `FINANCIAL_MODEL.md`,
   `SECURITY.md`, `OFFLINE_SYNC.md` were listed in the roadmap's documentation
   plan as "created in Phase 1" and weren't written.
3. **The promised `rev` backfill script didn't exist.**

All three are now closed:

- `Workspace.featureOverrides` (validated against known flag names) is layered
  on top of the env defaults by `GET /api/v1/features` for a signed-in caller
  with a resolvable workspace. Closing this also caught a real wiring bug: the
  client's `useFeatureFlags()` called the endpoint with `skipAuth: true`
  unconditionally, which stripped the access token even for a signed-in user
  — so a workspace override could never have reached the client regardless of
  the server-side fix. Fixed by removing the unneeded flag (the route never
  requires auth, so there was no reason to withhold the token when one exists).
- `docs/FINANCIAL_MODEL.md`, `docs/SECURITY.md`, `docs/OFFLINE_SYNC.md` are
  written and linked from the README.
- `npm run backfill:rev --workspace server` (dry run by default, `--apply` to
  write) exists, is idempotent, and its core logic is covered by 4 tests
  running against the suite's real in-process database — not a mock.

9 new tests came out of closing these (5 for per-workspace flags and the
client wiring fix, 4 for the backfill script), on top of the numbers below.

## Known follow-ups — next phase

- Phase 2 (Quick Entry 2.0, payees, category rules, tags, real search, Daily
  Money home) is next per the roadmap; it should also close the
  no-transaction-edit-UI gap found above.
- Nothing is actually gated behind a flag yet — the mechanism (global default
  + per-workspace override) is built and tested, but the first flagged module
  (Phase 3+) will be the first real end-to-end use of it.
- The i18n catalogue currently covers only the strings this phase touched;
  full extraction is Phase 14, as planned.
- Client edit forms surface a stale-revision conflict via the existing
  generic error banner (the server's message is plain language already) —
  no dedicated "someone else changed this, reload?" UI was built; worth
  revisiting once Phase 9 (household workspaces, where conflicts become
  routine) is closer.
