# Phase 12 — Business Operations — Verification Notes

Scope: [`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md#phases-1113--business-p2p3-business-workspaces-only),
the "12" bullet: sales vs purchases, receivables/payables ageing, petty cash
2.0, basic inventory, business reports and P&L.

## What shipped

**Profit & loss** (`report.service.ts#getProfitAndLoss`) composes the
*existing* `getIncomeExpenseStatement` for both income and expense plus a
net line — there is no second category-aggregation pipeline to keep
consistent with the first. "Sales vs purchases" is this: revenue is
whatever the ledger already categorises as income, expenses are whatever
it already categorises as expense, net profit is the difference. A
business workspace reads this as its P&L; nothing new had to be taught to
the categorisation engine.

**Receivables/payables ageing** (`report.service.ts#getAgeingReport`) is
the one genuinely new reporting primitive this phase needed — it didn't
exist in any form. It combines two sources that live in separate models:
unpaid invoices (Phase 11's `Invoice.dueDate`) and outstanding `lend`/
`borrow` transactions (Phase 9's `Transaction.dueDate`), bucketed by the
same days-past-due rule (not due, 0–30, 31–60, 61–90, 90+) into one view —
so "a customer who hasn't paid an invoice" and "a person who hasn't repaid
a loan" show up side by side under receivables, and symmetrically for
payables.

**Petty cash cash-counts** (new `PettyCashCount` model,
`pettycash.service.ts#recordPettyCashCount` /
`#getPettyCashDailyReport`) layer the same "expected vs counted" idea
`DayClosing` already applies to the main cash accounts onto the petty cash
float specifically. A count never adjusts the float itself — it's a record
of what was physically found against what the float should currently hold
(imprest minus spend since the last top-up), the same non-destructive
posture `DayClosing` takes with its own `differenceMinor`. The "daily
report" ties this to spend-by-category since the last replenishment and
recent count history in one view.

**Basic inventory** (new `Product` + `StockMovement` models,
`modules/inventory/product.service.ts`) is a clean build — nothing existed
here before. `stockQty` is a read cache the same way `Account.cachedBalanceMinor`
is: the real record is the sum of `StockMovement` rows, every write to it
goes through one atomic, conditional `$inc` (`recordStockMovement`), and a
`stock out` that would take the count negative is rejected by the same
update's match condition rather than checked-then-written — so a race
between two concurrent sales can't oversell stock the way a check-then-write
could.

## Deliberate scope reductions

- **"Overdue" ageing reuses Phase 11's existing derived-status discipline.**
  No new stored status, no cron job — a `sent` invoice past its due date is
  found directly from `Invoice.status === 'sent' && dueDate < now` in the
  same query that builds the ageing rows.
- **No COGS, gross margin, or inventory-aware P&L.** The roadmap explicitly
  defers itemised tax/COGS specifics to Phase 13; this phase's P&L is
  revenue-minus-expense exactly as the ledger already categorises both
  sides, with no attempt to infer cost-of-goods from inventory movements.
  An inventory `costPriceMinor` field exists for the business owner's own
  reference and margin calculation on the product screen, but it does not
  yet feed into the P&L report.
- **No automatic stock deduction when an invoice item is for a stocked
  product.** Invoices and inventory are not yet linked — recording a sale
  on an invoice and recording the matching stock-out are two separate
  manual actions. Auto-linking would need invoice line items to optionally
  reference a `Product`, which Phase 11 didn't build and this phase didn't
  retrofit; named here as the clearest next integration point rather than
  silently left out.
- **No denomination-level (notes/coins) breakdown for a petty cash count.**
  `countedMinor` is a single total, same granularity `DayClosing.actualClosingMinor`
  already uses for the main cash accounts — consistent with the existing
  convention rather than a new, more detailed one invented just for petty
  cash.
- **Ageing and P&L are new tabs on the existing Reports page, not new
  routes.** Consistent with how every other report in this app already
  lives — one tabbed statement reading the same live ledger, not a
  proliferation of single-purpose pages.

## Security posture

- `/products` and its sub-routes are gated by the existing
  `requireBusinessMode` middleware — the same gate `petty-cash` and
  `closing` already use, not a new convention invented for this phase.
- Every inventory and ageing read is scoped by `workspaceId` exactly like
  every other collection; a product id or petty-cash id from another
  workspace resolves as not-found, never leaked.
- Stock movements can't be used to oversell: the conditional `$inc` on
  `recordStockMovement` is the same class of defence as `assertSufficientBalance`
  already provides for account balances — a concurrent request can't push
  a count below zero no matter how it's timed.

## Verification

1. `npm run typecheck` — clean (shared, server, client).
2. `npm run lint` — clean, repository-wide.
3. `npm test` — server **292/292** (8 new: P&L netting, combined
   invoice+loan receivables ageing and borrow-based payables ageing with
   correct bucketing, a petty cash count against the live expected figure
   surfaced correctly in the daily report, SKU-uniqueness, the full
   in/out/adjustment stock lifecycle including the oversell-refusal case,
   business-mode gating, and cross-workspace isolation). Client 78/78,
   unchanged — no client-side test added for the new Sheets/tabs, same
   reasoning as every feature sheet since Phase 3.
4. `npm run build` — succeeds; `ProductsPage` code-splits into its own
   chunk like every other route.
5. **Not verified against a live browser session.** This environment's
   `npm run dev` points at a real MongoDB Atlas database
   (`server/.env`), and prior guidance in this project is not to seed or
   exercise that database without the user's explicit consent — the same
   constraint that applied to every UI-only phase before this one in this
   session. Verification here is typecheck + lint + the full automated
   test suite + a successful production build, not a manual click-through.

## Known follow-ups — next phase

- Linking invoice line items to `Product` (auto stock-out on sale) is the
  clearest next step for inventory, named above rather than silently
  deferred.
- GST specifics (Phase 13) are next per the roadmap.
