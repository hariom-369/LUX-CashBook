# Phase 13 — GST-Ready Data — Verification Notes

Scope: [`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md#phases-1113--business-p2p3-business-workspaces-only),
the "13" bullet: GSTIN, HSN/SAC, CGST/SGST/IGST, place of supply,
inclusive/exclusive pricing and tax summaries. **No filing or return claims
are made anywhere in this app** — every GST figure here is for a business
owner to hand to their accountant, not a GSTR submission.

## What shipped

**A pre-existing, half-wired field set was the real starting point.**
`Workspace.businessName`/`businessAddress`/`gstin` already existed in the
model and were already accepted by `PATCH /workspaces/:id` — from an
earlier phase — but `toWorkspaceDto` never returned them, so nothing on
the client could ever read them back, and no settings screen existed to
set them. This phase finished that wiring (exposed in `WorkspaceDto`, a new
"Business profile" sheet in Settings → Workspaces) rather than building a
parallel field set, and added the one thing genuinely missing: `state`,
the workspace's own state for place-of-supply comparison.

**Place of supply decides CGST+SGST vs IGST** (`lib/invoiceMath.ts#splitGst`)
by comparing the workspace's own `state` against the customer's `state`
(now on `Person`, alongside a `gstin` field) at the moment an invoice or
quotation is created — and that comparison is frozen onto the document as
`placeOfSupplyState`, never recomputed later just because someone edits a
state field afterward. If either state is unknown, the tax is left as
IGST with no CGST/SGST split, rather than silently assuming same-state —
guessing here would misstate a real figure someone relies on.

**Inclusive vs exclusive pricing** (`computeInvoiceTotals`, extended) is
not a UI-only toggle — it changes which direction the arithmetic runs.
`exclusive` (everything Phase 11 ever did) treats a line's amount as the
taxable value and adds tax on top; `inclusive` treats it as already
including tax and backs the taxable value out of it (`grossAfterDiscount / (1 + rate/100)`).
Both still produce the same `InvoiceTotals` shape, so nothing downstream
(payment posting, the P&L, the ageing report) needed to know which mode
produced a given invoice.

**HSN/SAC is per line item, not per product.** Line items were never
linked to a `Product` (a named gap from Phase 11/12), so there was nowhere
to pull a code from automatically — `hsnCode` is entered manually on each
invoice/quotation line (and, separately, on a `Product` itself, for the
business owner's own reference, though the two aren't connected yet).

**A GST summary report** (`report.service.ts#getGstSummary`) aggregates
CGST/SGST/IGST by tax rate across every issued invoice (`sent`, `overdue`
or `paid` — never a `draft`) in a date range, as a new Reports tab
alongside Profit & Loss and Ageing from Phase 12.

## Deliberate scope reductions

- **No GSTR filing, no return format, no e-invoicing/e-way-bill
  integration.** Named explicitly in the roadmap as out of scope; this
  phase produces numbers an accountant can use, nothing that claims to be
  a filing.
- **No invoice-line-to-`Product` linking**, so HSN/SAC can't be
  auto-filled from inventory and a sale doesn't auto-deduct stock — the
  same gap Phase 12 named, now touched by two features instead of one,
  still not solved. The clearest next integration point across both
  phases.
- **GST rate is a single overall percentage per invoice/quotation, not
  per line item.** A real invoice can legitimately mix rates across lines
  (0%, 5%, 18% items on the same bill); this phase's `taxPercent` applies
  uniformly to the whole document, consistent with how Phase 11 always
  modeled tax. Per-line rates would be a larger data-model change than
  this phase's "make it GST-ready" framing asked for.
- **No reverse charge, no composition scheme, no e-invoice QR.** Real GST
  compliance has many more cases than a four-phase roadmap bullet could
  cover; this phase ships the foundational fields (GSTIN, state, HSN/SAC,
  the tax split, inclusive/exclusive pricing) rather than attempting
  completeness.

## Security posture

- No new authorization surface: GSTIN/state/HSN additions are ordinary
  optional fields on existing, already-scoped models (`Workspace`,
  `Person`, `Product`, `Invoice`, `Quotation`), validated the same way
  every other field on those models already is.
- `getGstSummary` is workspace-scoped exactly like every other report —
  no new query pattern, no new way to reach another workspace's data.

## Verification

1. `npm run typecheck` — clean (shared, server, client).
2. `npm run lint` — clean, repository-wide.
3. `npm test` — server **300/300** (8 new: business-profile and
   customer-GSTIN/state round-trips, intra-state CGST+SGST splitting,
   inter-state IGST, the "unknown state defaults to IGST, never guesses"
   case, GST recomputation when an invoice's customer changes to a
   different state, inclusive-pricing back-calculation, and the GST
   summary report aggregating correctly by rate while excluding drafts).
   Client 78/78, unchanged — no client-side test added for the new
   fields/tabs, same reasoning as every feature sheet since Phase 3.
4. `npm run build` — succeeds.
5. **Not verified against a live browser session** — same constraint as
   Phase 12 and every other UI-only phase in this session: this
   environment's `npm run dev` points at a real MongoDB Atlas database,
   and prior guidance is not to seed or exercise it without the user's
   explicit consent.

## Known follow-ups — next phase

- Invoice-line-to-`Product` linking (shared with Phase 12's named gap) —
  would let HSN/SAC auto-fill and a sale auto-deduct stock in one move.
- Per-line GST rates, if real usage shows single-rate-per-invoice is too
  restrictive.
- Phase 14 (Hindi and localisation) is next per the roadmap.
