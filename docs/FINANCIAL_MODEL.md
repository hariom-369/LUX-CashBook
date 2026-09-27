# Financial Model

The rules every feature that touches money must follow. Full architectural
context is in [`ARCHITECTURE.md`](ARCHITECTURE.md) §2–3; this document is the
checklist for a feature author.

## Non-negotiable invariants

1. **Money is an integer minor unit (paise), never a float.** Every monetary
   field goes through `moneyField()` (`server/src/models/shared.ts`), which
   rejects non-integers, NaN and values outside `MAX_AMOUNT_MINOR`.
2. **A balance is derived, never the source of truth.** `Account.cachedBalanceMinor`
   and `Person.cachedBalanceMinor` are caches over the transaction postings —
   `services/balance.service.ts#verifyIntegrity` can always recompute them from
   scratch and must always agree.
3. **A transaction has one posting, or exactly two that cancel for a transfer**
   (`models/Transaction.ts`, enforced in `pre('validate')`). This is what makes
   a transfer atomic within one document — there is no in-between state where
   money has left one account and not yet reached the other.
4. **Lending and borrowing are never income or expense** (invariant I6). A
   `lend`/`borrow`/`repayment_*` transaction can never carry a `categoryId`.
5. **Nothing is hard-deleted.** Every financial model has `deletedAt`/`deletedBy`;
   delete reverses the balance effect and restore reverses it back — the row
   itself never disappears.
6. **Every write is scoped to `(userId, workspaceId)`**, re-verified against the
   database on every request (`middleware/auth.ts#requireWorkspace`). A
   client-supplied id is a request, never a grant.
7. **Multi-step financial writes are atomic** — `lib/transaction.ts#withTransaction`
   uses a real MongoDB transaction where the deployment supports one (a replica
   set), and a compensating-rollback fallback otherwise. Never write a second
   financial document assuming the first succeeded without one of these.
8. **A repeated write must not double-post.** `POST /transactions` accepts an
   `Idempotency-Key`; a retried request with the same key returns the original
   result, not a second transaction.

## How to add money movement to a new feature

Every feature that needs to record money — Phase 4's installments, Phase 8's
splits and group expenses, Phase 11's invoice payments — **creates ordinary
transactions through `createTransaction`** (`modules/transactions/transaction.service.ts`),
inside `withTransaction` if it's more than one write. It does not:

- write directly to `Transaction.postings` or `Account.cachedBalanceMinor`,
- invent a new "amount" field outside `moneyField()`,
- compute an authoritative balance in the frontend (the frontend may display a
  total, but the backend's postings are what's true).

A feature that can't be expressed as ordinary transactions is a sign the
design needs revisiting before it's built — see decision 1 in
[`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md) for how split transactions and group
expenses were kept inside these rules instead of loosening the posting model.

## Optimistic concurrency (`rev`)

Added in Phase 1 (decision 2). Every editable financial model — Transaction,
Account, Person, Budget, SavingsGoal, RecurringTransaction — carries a `rev`
integer, returned in its DTO.

- `rev` is bumped **only by a user edit**, via `lib/revision.ts#claimRevision`,
  called immediately before the record is saved. It is never bumped by internal
  bookkeeping — a balance-cache recompute, a repayment allocation, a recurring
  sweep posting an occurrence — because those aren't edits the user made to the
  record's own fields.
- An editor sends back the `rev` it read. A mismatch — someone else saved a
  change in between — is refused with `409 STALE_REVISION` and a plain-language
  message, never a silent overwrite.
- The check is a single atomic `findOneAndUpdate`, so two simultaneous edits at
  the same revision can't both "win."
- `rev` is optional on every update request. A client that omits it keeps
  today's last-write-wins behaviour — this is additive, not a breaking change.
- A record from before this field existed has no stored `rev`; `claimRevision`
  and the DTOs both treat that as `0`. `npm run backfill:rev --workspace server`
  (dry run by default, `--apply` to write) sets it explicitly on any old record,
  which isn't required for correctness but keeps every document's shape uniform.

A feature that lets a record be edited by more than the party who created it —
household workspaces (Phase 9), offline sync 2.0 (Phase 15) — builds its
conflict handling on this field rather than inventing a second mechanism.

## What's still last-write-wins

Fields that only ever move forward under a guarded `$inc` (`Transaction.settledMinor`,
`RecurringTransaction.occurrencesCreated`) are not part of `rev` and don't need
to be — the guard *is* the concurrency control for those, and two concurrent
repayments already can't over-settle a loan (see `ledger.test.ts`, "refuses to
repay more than is outstanding").
