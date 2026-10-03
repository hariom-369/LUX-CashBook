# Phase 2 — Quick Entry & Everyday Speed — Verification Notes

Scope: [`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md#phase-2--quick-entry-and-everyday-speed),
plus closing the transaction-edit-UI gap [`ROADMAP_PHASE1_NOTES.md`](ROADMAP_PHASE1_NOTES.md)
flagged. This phase is **partial by deliberate scope decision, not partial by
accident** — see "Deferred" below. Nothing removed, no existing screen's
behaviour changed except where a listed item required it, no bypass of the
transaction engine from the frontend.

## What shipped

**Transaction edit UI** — closes [`PRODUCT_AUDIT.md`](PRODUCT_AUDIT.md) finding
U-6.
- `TransactionDetailSheet.tsx` now has a real edit mode: amount, account/
  to-account, category, payee, date/due-date, description, payment method,
  reference number, tags (via the new `TagsInput`), and notes. `type` and the
  linked `personId` are intentionally never editable — the server schema has
  never allowed changing them, and re-typing a transaction is a delete-and-
  recreate, not an edit.
- Sends the transaction's `rev` (Phase 1's optimistic-concurrency field) on
  every `PATCH`; a `409 STALE_REVISION` is caught and shown as a plain-language
  "someone changed this, reload" message rather than a generic error.
- Server-side `updateTransaction` and its `rev` handling already existed from
  Phase 1 and needed no changes — only the client was missing.

**Payees** — a merchant/vendor a transaction can be tagged with, distinct from
a `Person` (which always carries a lending balance).
- New model, full CRUD route (`server/src/modules/payees/`), Settings tab
  (`PayeesSettings.tsx` + `PayeeFormSheet.tsx`): name, default account, default
  category, tags, notes, archive-or-delete (archived if referenced by a
  transaction, matching `Category`'s existing pattern).
- `Transaction.payeeId` (indexed per workspace) flows through create/update,
  list filtering (`payeeIds`), and the DTO (`payeeName`, hydrated alongside
  category/account the same way).
- Quick Add: a payee picker (non-personal, non-transfer types only) that
  prefills account/category from the payee's defaults — **only when those
  fields are still empty**, so it never overwrites a choice the user already
  made. Picking a payee bumps its `lastUsedAt`.

**Global search** — the command palette (`Ctrl/Cmd+K`) searched only its own
static list of pages/actions before this phase.
- Typing 2+ characters now also searches transactions and people, debounced
  250ms, through the exact same `/transactions` and `/people` endpoints their
  own list pages already call — no new backend search logic to keep in sync.
- Results merge into the same keyboard-navigable list as static commands.
  Selecting a transaction goes to `/transactions?q=<description>` (the
  transactions list now reads `?q=` on load); selecting a person goes to
  `/people/:id`.
- A stale, slow-resolving request is discarded if a newer one has already
  resolved — verified by a dedicated regression test, not just by the debounce
  timing working out in practice.

## A real bug caught while building this

- `docs/PRODUCT_AUDIT.md`'s note about irregular whitespace from Phase 1
  recurred: typing `   ` as an actual non-breaking-space
  character (not the escape sequence) in the new category `<option>` list and
  in `PayeeFormSheet.tsx` tripped ESLint's `no-irregular-whitespace` again.
  Same fix as Phase 1 — the escape sequence in source, not the raw byte. Not a
  functional bug, but the second time this exact mistake has happened in this
  codebase, worth naming so it isn't a third.
- A new test (`editTransaction.test.ts`) initially named its test account
  `'Cash'`, colliding with the account `createTestUser()` auto-creates during
  registration, causing a spurious `409` on account creation. Renamed the test
  fixture; not a product bug, a test-isolation mistake.

## Deferred — named in the roadmap's Phase 2 scope, not built this session

To ship the above fully wired end-to-end — real UI, real backend, real tests,
nothing orphaned — rather than partially start everything, these Phase 2 items
were **not** built and remain open:

- **Category rules** (auto-categorize by payee/description pattern).
- **Tags management UI** — the `TagsInput` component and tag-based filtering
  already existed/were extended, but there's still no dedicated screen to
  rename, merge, or delete a tag across all transactions at once.
- **Daily Money home screen** (the roadmap's proposed dashboard redesign).
- **Quick Entry natural-language parser improvements** (account detection from
  free text) — the existing NL parser (`naturalLanguageEntry.ts`) is untouched.

None of these were started, so there's no half-built surface to confuse a
future session — the next Phase 2 pass (or Phase 3, if the user chooses to
move on) starts clean on whichever of these it picks up.

## Verified by

1. `npm run typecheck` — clean (shared, server, client).
2. `npm run lint` — clean, repository-wide.
3. `npm test` — **265/265 passing** (server 187, up from 171; client 78, up
   from 66): 16 new server tests (6 for transaction edit, 10 for payees) and
   12 new client tests (6 for `TagsInput`, 6 for command-palette global
   search).
4. `npm run build` — succeeds; main chunk gzip (~259KB) essentially unchanged
   from Phase 1's baseline (~258KB).
5. All server tests ran against the in-process MongoDB replica set only.

## Known follow-ups — next phase

- The four deferred items above are still open Phase 2 scope; pick up from
  here rather than re-auditing what already shipped.
- `PRODUCT_AUDIT.md` U-6 (no transaction edit UI) is resolved; no other
  open P/U finding was in this phase's scope.
- As with Phase 1's optimistic-concurrency conflicts, a stale-revision error
  on transaction edit still surfaces through the generic error banner — no
  dedicated conflict-resolution UI, consistent with the Phase 1 decision to
  defer that until household workspaces (Phase 9) make conflicts routine.

## Update — Phase 2 completed

Everything listed as deferred above is now built, tested and driven in a
browser (desktop 1280 px and mobile 390 px, in-memory database only).

- **Tags management** — Settings → Organise lists every tag in use with its
  entry count; rename, merge (several into one) and remove run across every
  entry in one atomic server transaction (`modules/tags`). A tag report and a
  tag filter on the transaction list already existed.
- **Category rules** — `CategoryRule` (plain lowercase text, never a regex;
  matched as a substring with a manual word-boundary check). A rule only ever
  *suggests*: Quick Add shows "Use Food?" under the description, with a
  confidence taken from how often a rule has been accepted, and the person can
  save the pairing as a rule. Creating or changing a rule never touches an
  existing transaction (tested).
- **Quick Entry 2.0** — the parser (`lib/naturalLanguageEntry.ts`) now reads
  an account named after "from / using / via" or a kind of account ("using
  UPI") when exactly one account fits, both ends of a transfer ("from SBI to
  GPay", in either order), "Rahul owes me ₹1,200" (lend) and "I owe Rahul 500"
  (borrow). What it cannot work out is *named, not guessed*: Quick Add lists
  "Which account did you use?", "Who was this with?", "How much was it?" until
  the person answers. Several accounts of one kind are never guessed between.
- **Global search** — the palette now also finds accounts and payees, and
  reads structured questions: "above ₹5000", "Zomato last 3 months", "UPI
  expenses" (`lib/searchQuery.ts`; integer paise, no floating point). It only
  maps words onto filters the transaction list already has, shows exactly what
  it understood ("See matching entries — Expenses · GPay · above ₹5,000"), and
  leaves an ordinary query ("cash withdrawal") exactly as before. The list
  reads the link on arrival *and* while already open, accepting only values it
  offers; a payee result opens the list with a removable payee chip.
- **Daily Money home** — an opt-in simplified start screen (`/today`):
  balance, spent today, safe-to-spend, what is due, who owes whom. It adds no
  accounting rule: today's spend is the same server `expense` figure the
  dashboard counts, and safe-to-spend is the per-day figure the budget screen
  already computes, from *overall* budgets only (no category, no account). With
  none it says so rather than inventing one; an exceeded budget says "over",
  never a negative allowance. The choice is `preferences.homeScreen`
  (default `dashboard`; older accounts without it behave as `dashboard`) and
  `/?full=1` always reaches the full dashboard.

**Bugs the browser run caught (not visible to the unit tests)**
- The dashboard payload's `budgets` is a permanent empty placeholder, so the
  first Daily Money read budgets from it and showed "set a budget" for a user
  who had one. It now reads `/budgets`. Budgets were also never refreshed by a
  new expense; the ledger invalidation now includes them.
- The transaction detail sheet held the copy taken at the click, so after a
  reimbursement step the panel did not update and the next step would have
  failed as stale. The sheet now shows the refetched entry.
- The filled `Button` component had a duplicate class list, so the
  forced-colours edge was added to one copy only.

**Still open in Phase 2:** none from the original scope. Not done by design:
an account word that matches several accounts in a palette query is left as
text (the list's account filter is single-valued).
