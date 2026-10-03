# Phase 11 — Freelancer Mode — Verification Notes

Scope: [`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md#phases-1113--business-p2p3-business-workspaces-only),
the "11" bullet.

## What shipped

**Invoices, quotations and projects**, built around the existing ledger
rather than beside it: an invoice's line items, discount and tax are
computed once, server-side (`lib/invoiceMath.ts`), and paying one
(`invoice.service.ts#markInvoicePaid`) posts an ordinary `income` transaction
through the same `createTransaction` every other feature uses — inside the
same `withTransaction` that flips the invoice's own status to `paid`, so the
two can never disagree. A paid invoice's revenue shows up in cash flow,
reports and net worth exactly like any other income, because it *is* any
other income.

**Sequential numbering** (`INV-2026-00001`, `QUO-2026-00001`) is a new
primitive this codebase didn't have before — a `Counter` document keyed by
`{workspace, docType, year}`, bumped with the same atomic `$inc` pattern
`lib/revision.ts` already uses for `rev`, and claimed inside the same unit
of work that creates the invoice. Verified under concurrency: five
simultaneous invoice creates in the test suite always produce five distinct
numbers.

**Quotations convert into invoices, not into themselves.** Accepting a
quotation and converting it creates a brand-new `Invoice` with its own
number, copying the quotation's items/totals — the quotation document
itself is marked `converted` and left exactly as the customer saw it, never
mutated into an invoice in place.

**Customers and vendors are still just People.** The roadmap sketch asked
for "customer/vendor profiles [that] extend today's People-based lists" —
`PERSON_RELATIONSHIPS` already had `customer`/`supplier` from an earlier
phase, so an invoice's customer is a plain `personId`, and the existing
Customers/Suppliers screens, balances and ledgers apply unchanged. No new
customer model was needed or built.

**Projects track billable expenses through a new, additive `Transaction`
field** (`projectId`, optional, nullable — the same shape as the existing
`payeeId`), not a parallel expense system. Any ordinary expense transaction
can optionally be attributed to a project; `project.service.ts#getProjectSummary`
computes billed (paid invoices), expenses (attributed transaction sum) and
profit live, on every read — never cached, same discipline as every
account/person balance in this app.

**An invoice is frozen once sent.** `updateInvoice` refuses any edit once
`status !== 'draft'` — the PDF a customer already has can never silently
disagree with what the app shows. Cancelling, not editing, is the only way
to correct a sent invoice; a paid invoice can't even be cancelled.

**PDF and send reuse existing infrastructure wholesale.** The invoice PDF
(`pdf.service.ts#generateInvoicePdf`) is built from the same `drawMasthead`/
`drawTableHeader`/`renderPdf` primitives every other statement PDF uses, and
the client downloads it through the same `lib/download.ts#downloadFile` every
other PDF button already calls — no new client infrastructure. "Send" emails
the customer through the existing `sendMail`, which already degrades
gracefully with no SMTP configured (same as every email this app sends); a
customer with no email on file simply doesn't get one, and the invoice is
still marked sent.

## Deliberate scope reductions from the roadmap's description

- **Discount is a flat amount, not a percentage.** Simpler to reason about
  and to validate ("cannot exceed the subtotal") than a percentage that
  could legitimately exceed 100% of some line but not the whole invoice.
- **Tax is a single overall percentage, not itemised GST (CGST/SGST/IGST,
  HSN/SAC).** That level of detail is explicitly Phase 13's job
  ("GST-ready data"); this phase's tax field is intentionally generic so
  Phase 13 can extend it rather than redesign it.
- **"Overdue" is derived, never stored.** The roadmap lists it as one of an
  invoice's statuses; storing it would need a cron job sweeping every sent
  invoice past its due date, and that job either runs on a schedule (one
  more thing that can silently stop working) or doesn't exist, leaving a
  window where the stored status lies. Instead, `sent` + `dueDate` in the
  past *is* overdue, computed the moment anything reads the invoice
  (`invoice.service.ts#displayStatus`) — always correct, nothing to keep in
  sync.
- **No PDF attached to the "send" email.** `nodemailer`'s transport does
  support attachments, but wiring that generically through `lib/mailer.ts`'s
  existing `MailMessage` shape is more surface than this pass needed — the
  customer gets a plain notification email; the PDF is a separate download
  the business owner can forward themselves. The existing `ShareButton`
  pattern (used identically for person ledgers) has the same limitation —
  it shares a text summary, never a file — so this isn't a new gap, just
  one this phase inherited rather than solved.
- **No invoice list/detail as full routed pages.** Every invoicing screen is
  a `Sheet` (same pattern as `BudgetFormSheet`, `AccountFormSheet`), not a
  dedicated route — consistent with how this codebase already treats most
  create/edit/view flows, and avoids a second navigation pattern just for
  this phase.

## Security posture

- Every new route (`/projects`, `/invoices`, `/quotations`) goes through the
  same `requireAuth, requireWorkspace` chain as everything else — a
  `viewer`-role member can read but not create or act on any of these
  (enforced once, inside `requireWorkspace`, unchanged from Phase 9).
- `projectId` on a transaction is resolved the same way `payeeId` already
  is (`assertProjectBelongs` — exact mirror of `assertPayeeBelongs`):
  looked up by id *and* workspace, so a project id from another workspace
  is rejected as not-found, never silently attached.
- An invoice/quotation's customer (`personId`) and project are both
  re-validated against the caller's own workspace on every create and
  update — never trusted from a stale client payload.
- `markInvoicePaid` is the one place real money moves in this phase, and it
  runs through `createTransaction` exactly like every other transaction —
  it inherits that function's own balance checks, workspace scoping and
  atomicity rather than reimplementing any of them.

## Verification

1. `npm run typecheck` — clean (shared, server, client).
2. `npm run lint` — clean, repository-wide.
3. `npm test` — server **284/284** (16 new: line-item totals math,
   discount-exceeds-subtotal and due-before-issue-date validation, number
   sequencing under concurrency and across separate series, the full
   draft→sent→paid lifecycle with its atomicity and double-pay/cancel
   guards, the derived `overdue` status, quotation→invoice conversion
   including the copied totals and the refused-twice/refused-when-declined
   cases, project profit computation from paid invoices and attributed
   expenses, and cross-workspace isolation). Client 78/78, unchanged — no
   client-side test added for the new Sheets, same reasoning as every
   feature sheet since Phase 3.
4. `npm run build` — succeeds; every new page (`ProjectsPage`,
   `InvoicesPage`, `QuotationsPage`) code-splits into its own chunk like
   every other route.

## Known follow-ups — next phase

- GST specifics (GSTIN, HSN/SAC, CGST/SGST/IGST, place of supply) are
  Phase 13's job — this phase's single `taxPercent` field is the
  intentionally-generic placeholder it's meant to extend.
- Sales vs. purchases, receivables/payables ageing, inventory and business
  P&L (Phase 12) are next per the roadmap.
- No PDF-attached send email — named above as a deliberate reduction, not
  forgotten.
