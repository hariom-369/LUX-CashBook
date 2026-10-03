# Phase 8 — Splits & Groups — Verification Notes

Scope: [`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md#phase-8--splits-and-groups-p2-decision-1),
decision 1. Closes [`PRODUCT_AUDIT.md`](PRODUCT_AUDIT.md) finding D-1. Built
exactly to decision 1's specification — nothing here loosens the two-posting
validator; both features are several ordinary transactions, created
atomically, never a new kind of posting.

## What shipped

**Split transactions.** `POST /transactions/split` posts 2–20 ordinary
`income`/`expense` transactions sharing a generated `splitGroupId`, each
through the exact same `createTransaction` validation every other
transaction goes through — the only thing special is that they're created
together, atomically. Quick Add gained a "Split a payment" entry point
(a dedicated form, not bolted onto the existing single-category flow, which
has no natural place for N category rows) with an "split evenly" shortcut
built on a new shared helper, `allocateProportionally` — largest-remainder
apportionment, so parts always sum to exactly the total paisa for paisa.

**Expense groups**, built precisely to decision 1's model: a group expense
you paid is always one `expense` (your own share) plus one `lend` per member
with a share greater than zero — never a payment on someone else's behalf
that this app has no way to represent. This is also why groups need no debt
simplification: every member owes *you* directly (you fronted their share),
never each other, so there's no multi-party graph to simplify — "settle" is
just the ordinary person-repayment flow, already built since before this
phase. `ExpenseGroup` (members, drawn from existing `Person` records) and
`GroupExpense` (how one shared payment was split — `equal`, `exact`,
`percentage`, or `shares`, all reducing to the same `allocateProportionally`
core except `exact`, which is validated to sum to the stated total exactly)
sit alongside the real transactions rather than owning any financial state
themselves; deleting a group expense deletes those transactions through the
ordinary `deleteTransaction` path, so UNDO, the audit trail and balance
recalculation all work exactly as they do for any other transaction.

## A test-infrastructure bug this phase found and fixed

Building the atomic multi-transaction writes above required
`createTransaction` to optionally join a caller's own database transaction
(a new optional `externalUow` parameter — every existing call site omits it
and is completely unaffected) instead of always opening its own, since
Mongoose/MongoDB transactions don't compose across independent
`withTransaction()` calls. The first test written against this — "rolls back
every part if one part is invalid" — failed: the first part's write
survived even though the second part's failure should have aborted both.

The root cause turned out to be nothing in this phase's new code: the whole
test suite has, since this project's test infrastructure was written, never
actually exercised a real multi-document MongoDB transaction. `supportsTransactions()`
is set by `detectTransactionSupport()`, which only ever ran from inside
`connectDatabase()` — but `tests/setup.ts` connects to its in-process
replica set directly via `mongoose.connect()`, bypassing `connectDatabase()`
entirely. Every integration test in this project, across every phase, has
been silently running through the *compensating-rollback fallback* path
(meant only for a standalone MongoDB without a replica set) rather than the
real transaction path `tests/setup.ts`'s own comment claims to be testing.

This was invisible until now because the fallback path happened to be
correct for everything already built — every existing multi-step write
either used `withTransaction` just once per request (no composition needed)
or didn't depend on a prior step's write being visible to roll back. This
phase's split/group code was the first to call `createTransaction` more
than once inside one logical operation, which is what exposed the gap.

**Fixed** by exporting `detectTransactionSupport` from `config/db.ts` and
calling it from `tests/setup.ts` right after connecting. With that one line
added, the *entire* existing test suite — ledger, backup/restore,
repayments, settlements, everything — was re-run under real multi-document
transactions for the first time, and **all 235 server tests still passed**,
meaning the financial engine itself was never wrong; only the tests'
verification of its atomicity guarantee (invariant I9) had a blind spot.
Production was never at risk either — `env.ts` already refuses to boot in
production without `MONGODB_URI`, and every real deployment target (Atlas,
any managed MongoDB) is a replica set, so `connectDatabase()`'s detection
has always run correctly there. This was purely a test-harness gap, now
closed, and every subsequent phase's tests benefit from it being closed.

## Verified by

1. `npm run typecheck` — clean (shared, server, client).
2. `npm run lint` — clean, repository-wide.
3. `npm test` — **313/313 passing** (server 235, up from 222: 4 new
   `allocateProportionally` tests, plus 9 new tests for split transactions
   and expense groups including the atomic-rollback case described above,
   member-validation, cross-workspace isolation, and delete restoring every
   balance; client 78, unchanged). The full suite was re-run after the
   `detectTransactionSupport` fix specifically to confirm nothing elsewhere
   depended on the fallback path's behaviour — nothing did.
4. `npm run build` — succeeds.
5. All server tests ran against the in-process MongoDB replica set, now
   genuinely exercising real multi-document transactions.

## Known follow-ups — next phase

- No client-side test for the split-payment form or the groups pages, same
  reasoning as every phase since Phase 3 — this codebase's test convention
  covers components and `lib/` modules, not full feature pages wired to
  React Query. The split-sum and group-share arithmetic they display is
  fully covered server-side (and now in `shared`, via `allocateProportionally`).
- Groups are scoped to "you paid, split among members" per decision 1 — not
  general multi-payer trip accounting (different people paying at different
  times, with a net settlement graph across all of them). That would need a
  materially different model tracking each member's net position across
  multiple payers, which is a legitimate larger feature in its own right,
  not attempted here.
- Phase 9 (household workspaces) is explicitly the next phase and is called
  out in the roadmap itself as the project's highest-risk phase — it should
  get a dedicated authorization test suite before anything in it ships,
  per the roadmap's own instruction.
