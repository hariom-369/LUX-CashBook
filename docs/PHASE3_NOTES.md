# Phase 3 — Verification Notes

## What shipped

**Backend** (`server/src/modules/{budgets,goals,recurring,reminders,notifications,reports}`)
- Budgets: live consumption computed from transactions (never cached), rollover, threshold
  alerts, status escalation (safe → warning → critical → exceeded)
- Savings goals: manual contributions or account-linked auto-tracking, achievement detection
- Recurring transactions: full scheduling (daily/weekly/monthly/yearly/custom), atomic
  claim-based posting so concurrent sweeps can never double-post, run-now/skip/pause
- Reminders: derived loan-due reminders kept in sync with the ledger via idempotent upsert,
  plus user-owned custom reminders
- Notifications: account-wide centre with dedupe keys so an alert never fires twice
- `services/scheduler.service.ts`: a 5-minute interval tick that posts due recurring
  transactions, syncs loan reminders, checks budget thresholds, and raises due-reminder
  notifications — every workspace isolated so one failure can't block another
- Reports: category breakdown (month-over-month), net worth (with 12-month history
  reconstructed from postings, not snapshots), monthly comparison, borrow/lend summary
- **14 new tests** covering budget live-recompute, goal achievement, the exact §30 example
  figures, recurring scheduler concurrency (two simultaneous sweeps → exactly one post),
  loan reminder lifecycle, and net worth / category report correctness —
  **88/88 total passing**

**Frontend** (`client/src/features/{budgets,goals,recurring,reports,notifications,insights}`)
- Budget cards with live progress bars, status badges, safe-daily-spend guidance
- Goal cards with contribution flow and account-linked auto-progress
- Recurring list with run-now/skip/pause controls
- Reports: tabbed overview/category/net-worth/monthly/borrow-lend, two new charts
  (net worth area, monthly comparison bars) sharing the validated colour-vision-safe
  palette via a new `useChartColors` hook (deduplicated from the dashboard chart)
- Notification centre with unread badge on the bell icon (polls every 60s)
- Insights page

## Verified by

1. `npm run test --workspace server` — 88/88 passing
2. `npm run typecheck` on server and client — clean
3. `npm run build --workspace client` — succeeds
4. **Live browser walkthrough** via headless Chromium: register → record an expense →
   create a budget → watch live progress (₹3,500 of ₹8,000, 43.8%, "On track") → create
   a goal → add a contribution → watch it hit the *exact* §30 spec figures (₹35,000 of
   ₹80,000, 43.75%) → recurring (empty state) → reports (overview, category breakdown
   correctly attributing the expense, net worth) → notifications (empty state). No console
   errors beyond expected pre-auth 401s and one harmless duplicate-account 409.

## A bug the live walkthrough caught that tests didn't

The workspace bootstrap (`workspace.service.ts`, from Phase 1) seeds a seeded default
"Cash" account via a direct `Account.create()` call that bypassed the negative-balance
guard `account.service.ts`'s `createAccount` applies to every cash account by default.
The seeded account could go negative while every manually-created cash account couldn't —
an inconsistency invisible to the test suite because every test creates its own accounts
explicitly through the API rather than relying on the seed. Caught because the live
walkthrough's net-worth report showed a negative asset figure from spending against an
unguarded ₹0 account. Fixed by setting `blockNegativeBalance: true` on the seeded account,
matching the documented default. All 88 tests still pass after the fix (none depended on
the old behaviour).

## Known follow-ups for later phases

- Recurring-transaction reminders (raised when `autoPost: false`) aren't yet surfaced in a
  dedicated "confirm this occurrence" UI — currently only the generic notification fires.
- The reports chart bundle continues to grow; the code-splitting warning from Phase 2 notes
  still applies and will be addressed in the Phase 5 performance pass.
- Client component tests remain minimal — Phase 5 adds RTL tests per feature.
