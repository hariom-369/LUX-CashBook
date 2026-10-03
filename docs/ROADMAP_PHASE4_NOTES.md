# Phase 4 — Lending 2.0 — Verification Notes

Scope: [`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md#phase-4--lending-20-p1). Two
of the five items the roadmap listed — a statement PDF per person and
"send reminder" via share/WhatsApp — turned out to already exist
(`GET /pdf/people/:id`, `<ShareButton>` on the person ledger). This phase's
real scope ended up narrower than planned: a per-loan timeline, installment
schedules, and a reminder message scoped to one loan rather than a person's
whole balance. Interest stays out, as the roadmap specified, until Phase 16.

## What shipped

**Per-loan timeline.** The person ledger has always shown one running column
across every transaction with that person; there was no way to see a single
loan's own thread — lent → repaid → repaid → remaining. `GET
/people/:id/timeline` (`server/src/modules/loans/loan.service.ts`) groups a
person's lend/borrow transactions and, for each, its linked repayments (via
the existing `parentTransactionId`) and remaining balance
(`amountMinor - settledMinor`, the same figure every other loan view already
trusts). Clicking a lend/borrow row in the person ledger now opens
`LoanDetailSheet` with that breakdown, the loan's own attachments (reusing
`AttachmentList` — attachments already worked on any transaction, including
loans, so nothing new was needed there), and a reminder scoped to just that
loan.

**Installment schedules.** `InstallmentPlan` (one per loan, `PUT`/`GET`/`DELETE
/loans/:id/installments`) stores only the schedule — due dates and amounts.
It deliberately has no `isPaid` flag: whether an installment is paid is
always derived by comparing its cumulative scheduled amount against the
loan's real `settledMinor`, so a plan can never say something the ledger
disagrees with. Feeds the existing reminder pipeline: `syncLoanReminders`
now raises one reminder per unpaid installment when a plan exists, in place
of the single loan-level reminder it raised before — and an installment
reminder disappears on its own the moment a real repayment covers it,
without the plan being touched.

**Per-loan reminder message.** `ShareButton` (already generic, already used
for the person-level summary) now also fires from `LoanDetailSheet` with text
scoped to one loan ("Reminder: Rahul owes you ₹5,000, due 15 Oct.") rather
than the person's overall balance — closes the actual gap behind the
roadmap's "send reminder" item, since the share mechanism itself was already
built.

## What was already done before this phase (found, not built)

- `generatePersonLedgerPdf` (`server/src/modules/pdf/pdf.service.ts`) — a real,
  working statement PDF per person, wired to a "PDF" button on the person
  ledger since before this phase.
- `<ShareButton>` — native share sheet / WhatsApp / copy, generic, already
  used on the person ledger.

`docs/PRODUCT_AUDIT.md`'s journey table had listed both as missing; that was
stale, not a gap this phase needed to close. Row 3 is corrected rather than
marked "resolved" for something it didn't actually do.

## Verified by

1. `npm run typecheck` — clean (shared, server, client).
2. `npm run lint` — clean, repository-wide.
3. `npm test` — **278/278 passing** (server 200, up from 194: 6 new tests for
   the timeline endpoint, installment CRUD and total-exceeds-loan validation,
   cross-workspace isolation, and the reminder-pipeline integration proving a
   real repayment clears an installment reminder without touching the plan;
   client 78, unchanged — see "Known follow-ups").
4. `npm run build` — succeeds.
5. All server tests ran against the in-process MongoDB replica set only.

## Known follow-ups — next phase

- No client-side test for `LoanDetailSheet` or the installment editor, for
  the same reason noted in Phase 3: this codebase's existing test convention
  covers components and `lib/` modules, not full feature sheets wired to
  React Query. The logic that matters (installment status derivation, the
  reminder-pipeline interaction) is covered server-side instead.
- The installment editor is a plain add/remove row list, not a "split evenly
  over N months" helper — a deliberate simplification; worth adding if real
  usage shows people want it.
- Interest remains explicitly out of scope, per the roadmap, pending Phase 16.
