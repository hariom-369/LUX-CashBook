# Phase 5 — Bank Import & Reconciliation — Verification Notes

Scope: [`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md#phase-5--bank-import-and-reconciliation-p1).
Closes [`PRODUCT_AUDIT.md`](PRODUCT_AUDIT.md) finding D-3. Entirely additive: a
new `/bank-import` module sits alongside the existing `/import-export` module
(which still round-trips Khata's own CSV export/import) rather than replacing
it, and account reconciliation reuses the `adjustment` transaction type and
posting mechanism Daily Closing already established in the original build —
no new way to move money, just a new, user-confirmed reason to use the one
that already existed.

## What shipped

**Column-mapping bank import.**
- `server/src/lib/bankParsing.ts` — `parseStatementDate()` (handles
  `dd/mm/yyyy`, `mm/dd/yyyy`, `dd-mm-yyyy`, `yyyy-mm-dd`, rejecting impossible
  dates like 31 Feb rather than letting JS roll them into March) and
  `parseStatementAmount()` (Indian lakh/crore grouping `1,00,000.50`, Western
  grouping, parenthesized or signed negatives, an optional `Rs`/`INR`/`₹`
  prefix).
- `ImportProfile` — a saved column mapping (date column, description column,
  either a single signed amount column or separate debit/credit columns,
  optional reference column) plus date format and default account, so a
  second month's statement from the same bank never asks to be mapped again.
- Three-step flow: `POST /bank-import/parse` (upload, see headers and a
  sample before committing to a mapping) → `POST /bank-import/preview`
  (classify every row) → `POST /bank-import/commit` (post only the rows the
  user kept selected). The file is re-sent on every call rather than held in
  server-side session state — no temp-file lifecycle to get wrong, matching
  how `/import-export` already works.

**Duplicate classification.** Every previewed row is `new`, `duplicate`
(same amount **and** matching reference against an existing transaction on
the account, within a 3-day window), `possible_duplicate` (same amount and a
close date, no reference to confirm it), or `invalid` (unparseable date or
amount). Nothing is ever auto-imported or auto-skipped based on this — the
preview is a recommendation, the user's row-by-row choice on commit is what
actually happens. A `possible_duplicate`/`duplicate` row can be imported
anyway, or marked "already recorded" — the latter sets the new
`reconciledAt`/`statementRef` fields on the *existing* transaction instead of
creating a second one.

**Account reconciliation.** `GET /accounts/:id/reconcile/preview` (read-only:
how far a statement balance is from `cachedBalanceMinor`, the same figure
every other account view already trusts) and `POST /accounts/:id/reconcile`
(posts the gap as an `adjustment` transaction — the exact mechanism and
transaction type Daily Closing already used for "record the difference",
reused rather than reinvented). A zero difference still returns a success
response with no transaction created; reconciling with nothing to fix is a
valid outcome, not a no-op the UI hides.

**Frontend.** `ImportWizard` (upload → map columns, with a live sample table
→ classified preview with a per-row action selector) and `ReconcileDialog`
(enter statement balance → see the gap → confirm), both reached from two new
buttons on the account ledger page.

## A scope note, not a bug

Reconciliation compares against the account's *current* cached balance, not
a balance "as of" the statement's date — the roadmap didn't specify which,
and a historical as-of-date reconciliation would need a new balance-at-date
query the rest of the app doesn't have yet. Reconciling right after importing
a statement (the normal flow) makes this distinction not matter in practice;
flagged here so it isn't mistaken for an oversight if it surfaces later.

## Verified by

1. `npm run typecheck` — clean (shared, server, client).
2. `npm run lint` — clean, repository-wide.
3. `npm test` — **288/288 passing** (server 210, up from 200: 16 new tests —
   6 for date/amount parsing and duplicate classification, 6 for commit
   behaviour and import profiles including a cross-workspace isolation
   check, 4 for reconciliation including the zero-difference and
   cross-workspace cases; client 78, unchanged — see "Known follow-ups").
4. `npm run build` — succeeds.
5. All server tests ran against the in-process MongoDB replica set only.

## Known follow-ups — next phase

- No client-side test for `ImportWizard` or `ReconcileDialog`, for the same
  reason noted in Phases 3 and 4 — this codebase's test convention covers
  components and `lib/` modules, not full feature sheets wired to React
  Query and file uploads. Parsing, classification and the reconciliation
  math are fully covered server-side.
- The duplicate-detection window (3 days) and amount-tolerance rules are
  fixed constants, not configurable per import profile — worth revisiting if
  a real statement format needs a wider window.
- Reconciliation posts one adjustment for the whole gap; it doesn't attempt
  to explain the gap in terms of specific missing rows (that's what the
  import preview's duplicate classification is for, run first).
