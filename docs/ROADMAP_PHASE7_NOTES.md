# Phase 7 — Planning & Insight — Verification Notes

Scope: [`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md#phase-7--planning-and-insight-p1p2).
The roadmap listed seven sub-features; this phase shipped four of them fully
wired and tested, and explicitly deferred the two largest (report builder,
reimbursements) rather than build every item partially. See "Deferred" below.

## What shipped

**Credit card centre.** `Account` gained `statementDay`, `dueDay`,
`minimumDueMinor` (all optional, credit-card-only in practice) alongside the
pre-existing but never-surfaced `creditLimitMinor` — which had no client UI
at all before this phase. `GET /accounts/:id/card-summary` derives
utilisation and the next due date from the account's own `cachedBalanceMinor`
and limit — never a second figure that could disagree with the real balance.
A new `syncCardDueReminders` (same upsert-by-`sourceKey` pattern as every
other derived reminder in this codebase) raises a payment-due reminder only
while the card actually carries a balance. The account form and ledger page
both gained the matching UI.

**Budgets 2.0.** `Budget` gained an optional `accountId` so a budget can be
scoped to one account's spending instead of the whole workspace — the
existing unique index moved from `{categoryId, period}` to
`{categoryId, accountId, period}` so a category can carry both a general and
an account-specific budget without colliding. `BudgetProgressDto` gained
`projectedSpendMinor` — a linear projection from the spend rate so far,
always rendered with "(estimate)" next to it. "Copy last month" turned out
not to map cleanly onto this app's budget model (a `Budget` document is an
ongoing limit, not a per-period one — see the scope note in Phase 5's and
this phase's notes for the pattern), so it became `GET /budgets/suggestions`:
categories with real spending last month and no active budget yet, each
pre-filling the create form with that amount rather than auto-creating
anything.

**Goals 2.0.** `GoalProgressDto` gained a derived `status`
(`achieved`/`ahead`/`on_track`/`behind`/`no_deadline`), comparing actual
progress against time elapsed toward the target date — a goal with no
target date is reported as `no_deadline` rather than guessed at. The real
gap behind "goals don't move money" (`PRODUCT_AUDIT.md`, journey 5) was
account-linked goals having no contribute action at all — `addContribution`
already correctly refused on a linked goal, it just didn't offer the
alternative. `POST /goals/:id/transfer-contribution` posts a real transfer
from a chosen account into the goal's linked account, through the same
`createTransaction` every other transfer uses.

**Cash-flow forecast.** `GET /forecast?days=7|30|90` walks every active
recurring income/expense item forward with the exact `computeNextRun` the
scheduler itself uses (so a projected date can never disagree with when the
item would actually post), starting from `getWorkspaceTotals()` — the same
total the dashboard already shows. Transfers are skipped (net zero across
the user's own accounts). Always returned with `isEstimate: true`; the new
Reports tab labels every number on the page as a projection, and the
dedicated `ForecastChart` is visually distinct from `NetWorthChart` (dashed
line, no dots) so the two are never visually confusable.

## Deferred — named in the roadmap's Phase 7 scope, not built this session

- **Report builder** (date/accounts/categories/tags/people/types → table,
  chart or summary; save, duplicate, export) — this is a standalone feature
  in its own right: a generic aggregation query builder, a `SavedReport`
  model, and a results renderer that can produce a table, a chart, *or* a
  summary from the same query. Compressing it into this phase alongside the
  other four would have meant shipping it partially; it hasn't been started
  at all; it's a clean pickup for a future session.
- **Reimbursements** (a status on expenses: pending → submitted → approved →
  paid, with the payout linked back) — also not started. This needs a new
  sub-document on `Transaction` and a status workflow with its own UI; it
  touches the transaction model in a way worth its own focused pass rather
  than a few hours alongside everything else here.

Both are still listed as open in `FEATURE_ROADMAP.md`'s Phase 7 section
rather than marked done.

## Verified by

1. `npm run typecheck` — clean (shared, server, client).
2. `npm run lint` — clean, repository-wide.
3. `npm test` — **300/300 passing** (server 222, up from 215: 7 new tests —
   card utilisation/due-date derivation and reminder lifecycle, account-scoped
   budget spend isolation, budget suggestions excluding already-budgeted
   categories, goal status transitions, transfer-contribution correctness
   and its refusal paths on the wrong goal kind, and the forecast's
   projected-total arithmetic; client 78, unchanged).
4. `npm run build` — succeeds.
5. All server tests ran against the in-process MongoDB replica set only.

## Known follow-ups — next phase

- Report builder and reimbursements remain the two largest open items from
  this phase's original scope — see "Deferred" above.
- No client-side test for the new `CreditCardSummary`, `BudgetSuggestions`,
  or `TransferContributeSheet` components, same reasoning as every phase
  since Phase 3: this codebase's test convention covers components and
  `lib/` modules, not full feature widgets wired to React Query. The
  derivation logic they display is fully covered server-side.
- The forecast's occurrence walk is capped at 500 occurrences per recurring
  item as a safety guard against a misconfigured daily/custom schedule —
  irrelevant at the 90-day maximum window this phase exposes, but worth
  knowing if the window is ever extended.

## Update — report builder and reimbursements shipped

Both items listed as deferred above are built.

**Report builder** (`modules/reports/reportBuilder.service.ts`,
`ReportBuilderTab`). A *closed*, strict zod schema — the client sends a
definition (period, optional accounts / categories / people / payees / tags /
types / amount range, one of an allow-listed set of groupings, and how to show
it), never a query. It reuses the transaction list's `buildFilter`, so the
builder cannot disagree with the list or reach anything the list could not
(private accounts included). Output is always an exact table with totals
(integer minor units); chart and one-line summary are views of the same rows
and never re-query. Grouping by tag overlaps (an entry with two tags appears
under both), so the response says so and the real totals are computed
separately rather than summed from the rows. Saved reports store the
*definition only* — never results — and can be updated, duplicated, deleted and
exported as CSV (POST, so a definition is not placed in a URL). Results are
capped (500 groups, flagged when truncated).

**Reimbursements** (`Transaction.reimbursement`, `ReimbursementPanel`,
Reports → Reimbursements). A tracking status on an *expense*: pending →
submitted → approved → paid, one step forward or back, or stopped. The payout is
a reference to an existing income entry. **No accounting effect by design** —
ledger, balances and categories are untouched; the outstanding figure is a sum
of the amounts of expenses still unpaid. Chosen not to invent a rule that
posts a receivable: that is a product/accounting decision that has not been
made. Optimistic-concurrency (`rev`) protected; filterable on the list.

Tests: server `reportBuilder`, `reimbursements`; client `ReportBuilderTab`,
`ReimbursementPanel`. Browser-checked (both widths), axe-clean. The browser
run found that the detail sheet showed a stale copy after a claim step — fixed
(see the Phase 2 update).

**Still open in Phase 7:** none from the original scope. Loan interest and
investments remain deferred (no specification).
