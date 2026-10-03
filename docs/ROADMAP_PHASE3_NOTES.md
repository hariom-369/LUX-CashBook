# Phase 3 — Bills, Subscriptions, Reminders — Verification Notes

Scope: [`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md#phase-3--bills-subscriptions-reminders-p1).
Closes [`PRODUCT_AUDIT.md`](PRODUCT_AUDIT.md) findings U-3 and U-5. Built entirely
on existing collections (`RecurringTransaction`, `Reminder`) plus one new field
(`billKind`) and two small new collections (`PushSubscription`,
`DetectorDismissal`) — no rework of the recurring engine, the reminder pipeline,
or any financial invariant.

## What shipped

**Bills & Subscriptions centre** (U-5: "four overlapping concepts with no
single 'what's due' place").
- `billKind` (electricity, water, gas, internet, phone, rent, EMI, insurance,
  subscription, other) on `RecurringTransaction` — optional, so every existing
  recurring item is unaffected until the user tags it.
- A new page (`/bills`) groups bill-tagged recurring items into Overdue, Due
  today, This week, This month, Later — reusing `GET /recurring` client-side;
  no new list endpoint.
- The existing Recurring page (salary, non-bill items) is untouched; Bills is
  a filtered view alongside it, not a replacement.

**Subscription detector** — suggests, never acts on its own.
- `detectSubscriptions()` (`server/src/modules/detector/`) scans up to 180 days
  of expenses grouped by payee (or normalised description) + account, requires
  at least 3 occurrences with a stable amount (±12%) and a stable interval
  (weekly/monthly/yearly, or a looser "custom" band) before calling it a
  pattern. It explicitly excludes anything already posted by a recurring
  template (`recurringId` set) — a pattern already on autopilot has nothing to
  detect.
- Three actions, all explicit: **Ignore** (recorded in `DetectorDismissal`,
  keyed by a stable signature so the same pattern is never re-suggested once
  dismissed), **Create bill** (calls the same `createRecurring` every manual
  bill uses, always `autoPost: false` regardless of what the form would
  otherwise default to — one confirmed occurrence before it's trusted to post
  itself), and doing nothing (the suggestion just sits there next visit).
- `RecurringTransaction` gained an optional `payeeId` (mirroring `Transaction`'s
  from Phase 2) so a bill created from a detected payee carries that link
  forward, and so transactions it later posts are attributed to the same
  payee automatically.

**Financial calendar** (`/calendar`) — month grid plus a per-day agenda, built
entirely from `GET /recurring` and `GET /reminders` merged client-side. No new
backend: the reminder pipeline already unifies loan-due and custom reminders
(built in Phase 1), and recurring items already carry `nextRunDate`.

**Browser push notifications** (decision 9, restoring the switch Phase 1 hid).
- `web-push` + a VAPID key pair (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`, unset
  by default — push is silently skipped with no behaviour change until a
  deployer configures it, same pattern as SMTP).
- `PushSubscription` (one row per browser), `/push/subscribe`,
  `/push/unsubscribe`, `/push/public-key`.
- Wired into the same four producers that already write to the `Notification`
  collection (budget alerts, goal reached, recurring reminders, due
  reminders) — push fires exactly once per notification actually created,
  never independently of the in-app one, and only for a user who both
  enabled the switch and has a live subscription.
- `sw.ts` gained `push` and `notificationclick` handlers; tapping a
  notification focuses (or opens) a tab and navigates it to the same link the
  in-app notification would use.
- Email and the monthly-summary digest remain off the table — email still
  needs a deployer's SMTP credentials (unchanged from Phase 1), and there is
  still no digest job to send a monthly summary from.

## A design decision worth flagging

The subscription detector's "already has a bill" exclusion only works for
payee-linked patterns (it checks `RecurringTransaction.payeeId`) — a pattern
detected from description alone (no payee attached to those transactions) has
no reliable way to confirm a bill wasn't already made for it beyond the
dismissal record. In practice this means: always attach a payee to recurring
expenses when one exists, which Quick Add and the recurring form both already
make easy (Phase 2).

## Verified by

1. `npm run typecheck` — clean (shared, server, client).
2. `npm run lint` — clean, repository-wide.
3. `npm test` — **272/272 passing** (server 194, up from 187: 7 new tests for
   billKind validation, detector suggestion/dismiss/create-bill, cross-user
   isolation, amount-instability rejection, and push subscribe/unsubscribe/
   public-key; client 78, unchanged — see "Known follow-ups").
4. `npm run build` — succeeds; `BillsPage` and `CalendarPage` code-split into
   their own ~4-5KB chunks; main chunk gzip (~259.6KB) essentially unchanged.
5. All server tests ran against the in-process MongoDB replica set only; no
   VAPID keys are configured in the test environment, so `deliverPushToUser`
   is exercised only down to its "not configured, skip" branch — never makes
   a real network call in CI or locally.

## Known follow-ups — next phase

- **No client-side test for `BillsPage` or `CalendarPage`.** Every existing
  client test in this codebase covers a component or a `lib/` module, not a
  full feature page wired to React Query — adding page-level tests here would
  be a new testing pattern, not a fix to something broken. The logic that
  matters most (subscription detection, amount/cadence classification) is
  fully covered server-side instead. Worth revisiting if a page-test pattern
  gets established elsewhere.
- The calendar's "week" view is the same month grid with a day selected below
  it, not a distinct 7-day layout — a simplification made for this pass, not
  a separate view the roadmap's phrasing ("day, week and month views")
  technically promised.
- Email and monthly-summary notifications remain switched off in the UI,
  same as Phase 1 — both need infrastructure (a working SMTP account, a
  digest job) beyond what this phase added.
