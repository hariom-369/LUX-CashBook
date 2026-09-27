# Khata — Product Audit (Phase 0)

**Status:** complete, for review. Nothing in the codebase was changed to produce
it. The roadmap built on it is in [`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md).

**Method.** Read-through of `server/`, `client/`, `shared/`, `docs/` and the test
suites, plus the live responsive audit recorded in
[`RESPONSIVE_NOTES.md`](RESPONSIVE_NOTES.md). Every finding below names the file
it comes from. "Verified" means the code was read or the behaviour was run;
anything inferred is labelled as such.

**Severity** — *Critical*: financial correctness or data exposure. *High*: a
feature that looks functional but isn't, or a gap that blocks a core journey.
*Medium*: real friction or risk with a workaround. *Low*: polish or tech debt.

---

## A. Existing architecture

Full detail is in [`ARCHITECTURE.md`](ARCHITECTURE.md); this is the part the
roadmap depends on.

| Layer | What exists |
|---|---|
| Monorepo | npm workspaces: `client/` (~14k lines), `server/` + `shared/` (~14k lines) |
| Data | MongoDB via Mongoose 8 — 17 models in 16 files under `server/src/models/` |
| API | Express 5, 23 route groups under `/api/v1` (`server/src/routes.ts`), Zod validation on every body/query |
| Engine | `modules/transactions/transaction.service.ts` + schema guards in `models/Transaction.ts` + `services/balance.service.ts` |
| Atomicity | `lib/transaction.ts` — real MongoDB transactions on a replica set, compensating rollback otherwise |
| Auth | JWT access token (memory only) + rotating httpOnly refresh token with reuse detection; scrypt hashing |
| Scoping | `middleware/auth.ts#requireWorkspace` — the **only** place workspace access is decided (owner check) |
| Background | `services/scheduler.service.ts` — 5-minute tick: recurring posting, loan reminders, budget alerts |
| Client | React 19, Vite, Tailwind v4, Zustand (5 stores), TanStack Query, route-level code splitting |
| Offline | Custom service worker (`client/src/sw.ts`), IndexedDB outbox + cache (`lib/offlineDb.ts`) |
| Tests | Server: 122 tests / 8 files against an in-process replica set. Client: 44 tests / 6 files |

### How money is modelled (the constraint every new feature must respect)

- A `Transaction` has **one posting, or exactly two for a transfer** (validator
  in `models/Transaction.ts`). Postings are signed integer paise; a transfer's
  two legs must cancel exactly.
- Eight types: income, expense, transfer, lend, borrow, repayment given,
  repayment received, and **adjustment** (used by day closing; a ready-made
  foundation for reconciliation).
- Lend/borrow mirror the account posting into `personDeltaMinor`; they can
  never carry a category. Repayments allocate against specific loans via a
  guarded `$inc` on `settledMinor`.
- Balances are derived from postings and cached (`cachedBalanceMinor`) with an
  integrity checker that recomputes and repairs (`verifyIntegrity`,
  `repairBalances`).
- Soft delete everywhere that matters; restore reverses cleanly.
- Idempotency keys on transaction creates (unique partial index).
- Closed months are locked (`assertPeriodOpen`).
- **Not present:** optimistic concurrency. `baseOptions.versionKey` is `false`
  and updates carry no expected version, so a stale edit silently wins.

---

## B. Feature inventory

Status legend: **Working** — end to end. **Partial** — works with a
significant gap. **Backend only** — API exists, no screen reaches it.
**Stored, not wired** — a setting is saved but nothing reads it.

| Area | Feature | Status | Notes / evidence |
|---|---|---|---|
| Core | 8 transaction types, transfers, loans, repayments, settle | Working | `transaction.service.ts`, `person.service.ts`; 31 ledger tests |
| Core | Soft delete, restore, edit, duplicate | Working | Edits are last-write-wins (see A) |
| Core | Idempotent create | Working | `idempotencyKey` + unique index |
| Accounts | Cash, bank, UPI, wallet, credit card, savings, investment, other | Working | Credit limit stored; no statement/due dates or utilization |
| Accounts | Account ledger + running balance + PDF statement | Working | `pdf/` → accounts, people, cash book |
| Cash book | Single / double / triple column, contra, discount | Working | `cashbook.service.ts` |
| People | Receivables/payables, partial repayment, settle, share summary | Working | No installments, interest or due-date schedule beyond one `dueDate` |
| Categories | Two-level income/expense categories, CRUD | Working | No rules or suggestions beyond the NL parser's name match |
| Budgets | Monthly/weekly/yearly, per category or overall, rollover, thresholds | Working | One category per budget; no account-specific budgets |
| Goals | Target, deadline, manual contributions or linked-account progress | Partial | Manual contributions don't record a money movement (`goal.service.ts` never writes a transaction) |
| Recurring | Daily…yearly/custom, auto-post or remind, skip, run now | Partial | Non-auto-post occurrences have no "confirm this occurrence" screen (still open from Phase 3) |
| Reminders | Loan-due reminders auto-generated | Working | — |
| Reminders | Custom reminders (bill, rent, EMI, subscription…) | **Backend only** | `/reminders` CRUD exists; `useReminders` is used by no page |
| Notifications | In-app list, read/unread | Working | Auto-expire after 90 days (TTL index) |
| Notifications | Email / push / monthly summary / per-type toggles | **Stored, not wired** | See finding P-1 |
| Reports | Category, net worth, monthly comparison, annual, borrow/lend, statement | Working | Six tabs; no custom report builder, no tag reports |
| Insights | Six descriptive insights | Working | Insights page re-renders the dashboard's insights (same query) |
| Dashboard | Widgets, reorder, hide, reset | Working | Stored per device (localStorage) |
| Quick entry | Type picker + natural-language parser (preview, never auto-saves) | Partial | No account detection ("from SBI", "using UPI"); no receipt attach in Quick Add |
| Search | Transaction text search (Mongo text index), people search | Partial | Command palette (Ctrl K) only navigates; it does not search data |
| Filters | Type, account, category, date range, deleted | Partial | Server also supports tags, amount range, has-attachment, outstanding-only — not exposed |
| Attachments | Image/PDF upload, re-encode + thumbnail (sharp), private download | Working | On the transaction detail screen only; no gallery; no OCR |
| Import | CSV import with preview and batch undo | Partial | See finding D-3 |
| Export | CSV export, PDFs | Working | See finding S-4 (formula injection) |
| Backup | JSON backup; restore into a **new** workspace | Working | Never overwrites live data. No encryption, checksum or partial restore |
| Business | Petty cash (imprest), daily closing, month closing, customers/suppliers | Working | Customers/suppliers are People filtered by relationship |
| Business | GSTIN, business name, logo, fiscal year | **Backend only** | Fields on `Workspace`; no screen edits them |
| Workspaces | Multiple personal/business workspaces, switch, default | Working | Single owner — no members or roles |
| Demo | `isDemo` flag, demo-aware delete ("reset demo data") | Partial | No demo data generator; `npm run seed` points at a missing file |
| Security | Sessions list + revoke, logout everywhere, change password, PIN lock, idle lock | Working | See S-3 on the PIN |
| Security | Account deletion | **Backend only** | `/users/me/delete` exists; no screen |
| Security | Audit log | **Backend only** | Written on every mutation; `/audit-log` has no screen |
| Data health | Balance/posting integrity check + repair | **Backend only** | `/integrity`; `useIntegrity` used by no page |
| Offline | App shell, cached reads, queued Quick Add creates, sync banner | Partial | Only Quick Add creates queue; everything else fails offline |
| PWA | Service worker, update prompt, manifest | Partial | Not installable — no icons (P-3) |
| Privacy | Privacy mode (blur), privacy-by-default | Partial | See S-2 |
| UI | Light/dark, responsive 320–2560px | Working | Residual edge cases in `RESPONSIVE_NOTES.md` |
| i18n | Language preference field | **Stored, not wired** | No translation layer; all strings hard-coded (not shown in the UI either) |

---

## C. Existing user journeys

| # | Journey | Path today | Friction |
|---|---|---|---|
| 1 | First run | Register → onboarding (mode, currency, first account) → dashboard | Short (three steps). No demo option; email verification is a banner, not a step |
| 2 | Record spending | Bottom-bar **+** → type picker *or* "Type it instead" → form → save | 3–4 taps minimum; account must always be picked manually; can't attach a receipt here |
| 3 | Lend / get repaid | People → person → Lend / Repay / Settle | Solid. No installments, no reminder message to send, no statement share as PDF from the phone flow |
| 4 | Find a transaction | Transactions → search/filters → detail sheet | Palette search doesn't search data; tag/amount filters hidden |
| 5 | Plan | Budgets / Goals / Recurring pages | Goals don't move money; recurring "remind me" occurrences need manual Run now |
| 6 | Understand | Reports (6 tabs), Insights, PDFs, CSV | No saved or custom reports; no tag or payee reports |
| 7 | Run a shop | Business workspace → Petty cash, Daily/Month closing, Customers/Suppliers | No invoices, sales/purchase distinction or inventory |
| 8 | Protect / move data | Settings → Data (backup, restore, import, export), Security | Import only fits Khata's own template; restore makes a copy (safe, but unexplained); no account deletion screen |
| 9 | Stay informed | Notifications page, dashboard "Due soon" | Notification toggles don't do anything (P-1); custom reminders can't be created |

---

## D. Findings

### Security and privacy

**S-1 · Critical · Financial API responses survive sign-out in browser storage.**
`sw.ts` caches GET responses for dashboard, accounts, transactions, people,
categories, cash book, budgets, goals and reports (`khata-api-cache-v1`,
200 entries, 7 days). `auth.store.ts#signOut` → `clear()` only nulls the
session snapshot; nothing deletes that cache or the IndexedDB `cache`/`outbox`
stores. The cache is keyed by URL alone, so on a shared device the previous
user's figures stay readable in DevTools and can be served offline to the next
person who signs in. *Verified in code; not exploited live.*

**S-2 · High · Privacy mode is a visual blur only.** `<Money>` always renders
the exact amount in `aria-label` and in the DOM text; `.sensitive` applies CSS
`filter: blur`. Screen readers, copy-paste of a parent element, and screenshots
of the accessibility tree all expose real figures while "hidden."

**S-3 · Medium · App-lock PIN.** `/auth/pin/verify` is rate-limited by the
shared auth limiter, but there is no per-account attempt counter or lockout,
and the lock is a client overlay — the access token stays live in memory while
"locked." Fine as a convenience lock; it should not be described as more.

**S-4 · Medium · CSV formula injection.** `importexport.service.ts` writes
`Description` and `Notes` unescaped. A value beginning `=`, `+`, `-` or `@`
executes as a formula when the export is opened in Excel/Sheets. Imported CSVs
can carry such values in.

**S-5 · Low · Local `.env` leaks into tests.** dotenv loads `server/.env` into
the Vitest process; with `COOKIE_CROSS_SITE`/`MONGODB_URI` set, 3 tests fail
(documented in `RESPONSIVE_NOTES.md`). A developer running `npm run dev` with a
deployment `.env` also writes to that database — now called out in the README.

**Strengths (verified):** scrypt hashing; refresh rotation with family revoke
on reuse; workspace ownership re-checked per request; rate limits keyed by user
id; helmet with CSP; private S3 with authenticated downloads; redacted logs;
account login lockout (`failedLoginAttempts`, `lockedUntil`); audit log on
mutations.

### Product integrity (features that look functional but aren't)

**P-1 · High · Notification settings do nothing.** The Notifications screen
shows 7 switches — In-app, Email, Push, Money due, Budget alerts, Recurring
reminders, Monthly summary. The server never reads
`preferences.notifications` (no reference outside the schema/model), there is
no push implementation (no Push API or web-push code), mail is only sent for
auth emails, and nothing produces a monthly summary. This is the only place in
the app that violates "every button must work or clearly say it doesn't yet."

**P-2 · Medium · Backend capabilities with no screen:** account deletion,
audit log, custom reminders, data-integrity check/repair, GST/business
profile, and four transaction filters. They are built and tested — the value
is simply unreachable.

**P-3 · Medium · The app can't be installed.** The PWA manifest declares
`icons: []` (`client/vite.config.ts`) and there is no `client/public/` folder,
so `/favicon.svg` (referenced in `index.html`) is a 404. Chromium browsers only
offer installation when the manifest has 192px and 512px icons, so the
"installed app" experience the offline work was built for isn't reachable.

**P-4 · Low · Dead code/config:** `features/ComingInPhase.tsx` (unused),
`ENABLE_DEV_ROUTES` (defined, never read), `npm run seed` (target file missing),
`npm run lint` (ESLint not installed, no config — the script can't run).

### Data and import

**D-1 · High · Two-posting limit.** Split transactions (one bill across
categories) and group expenses can't be expressed as a single transaction.
Any design must add them *around* the engine, not by loosening its validator
(see roadmap decision 1).

**D-2 · High · Single-owner workspaces.** `Workspace.userId` is the only
access grant; `requireWorkspace` checks ownership. Household mode needs a
membership model, a change to that one middleware, and a review of the 31
service queries that also filter by `userId` (the other 147 scope by
`workspaceId` and are unaffected).

**D-3 · High · CSV import is Khata-template only.** Fixed column names
(`Date, Type, Amount, Account, Category, Description`), income/expense only,
`new Date(text)` date parsing (a `dd/mm/yyyy` bank date is rejected or read as
US month/day), `Number(text)` amount parsing (rejects `1,250.00`), and no
duplicate detection. Unsuitable for bank statements as-is.

**D-4 · Medium · No optimistic concurrency.** Last write wins on every update.
Blocks safe offline editing and multi-member workspaces.

**D-5 · Medium · No payee/merchant concept.** `Person` is a lending
counterparty (and, with a relationship, a customer/supplier). Merchants like
"Jio" or "Swiggy" have nowhere to live, which also blocks category rules keyed
on payee.

**D-6 · Low · Single currency per workspace**, categories limited to two
levels, tags are free strings (normalised, max 20). All adequate for the stated
audience; noted as constraints, not defects.

### UX

- **U-1 · Medium** — Quick Add always needs a manual account choice; the NL
  parser detects type, amount, date, category and person but not account.
- **U-2 · Medium** — Global search (Ctrl K) navigates only; data search lives
  on individual pages.
- **U-3 · Medium** — No "confirm this occurrence" flow for remind-only
  recurring items; users must find them and press Run now.
- **U-4 · Low** — Insights page duplicates the dashboard's insights widget.
- **U-5 · Low** — Bills, subscriptions, reminders and recurring entries are
  four overlapping concepts with no single "what's due" place beyond the
  dashboard's Due soon list.
- **U-6 · High** *(found during Phase 1)* — **Transactions have no in-app edit
  form.** `TransactionDetailSheet` offers delete, restore and duplicate only.
  `updateTransaction` on the server is fully built, tested, and (as of Phase 1)
  supports optimistic-concurrency `rev` — but nothing in the client calls it.
  Fixing a typo'd description or amount today means delete-and-recreate,
  which loses the original's audit trail continuity. Flagged for Phase 2.

### Mobile / desktop / accessibility

- **Mobile** — the responsive pass is complete; residual items (₹10-crore
  figures in narrow tiles, iOS keyboard over sheets, emulation-only testing)
  are listed in `RESPONSIVE_NOTES.md`.
- **Desktop** — no bulk selection/actions, no sortable ledger tables, one
  keyboard shortcut (Ctrl K).
- **A-1 · High (for screen-reader users)** — the 9 settings switches
  (`NotificationSettings.tsx`, `PreferencesSettings.tsx`) have `role="switch"`
  but no accessible name.
- **A-2 · Medium** — the mobile drawer closes on Escape but has no focus trap
  or focus return.
- **A-3** — privacy mode exposes amounts to assistive tech (S-2).
- Strengths: skip link, focus-trapped sheets, `aria-live` toasts, labelled
  fields, `:focus-visible` styling, reduced-motion support, signed amounts
  (colour is never the only cue).

### Performance

- One shared app-shell chunk (~1.1 MB, ~255 KB gzipped); routes lazy-loaded;
  charts split. Acceptable today.
- Transaction list paginates at 50 without virtualisation — fine at current
  scale; revisit with bulk actions.
- Reports aggregate on the fly with supporting indexes; no caching layer.
  Adequate until workspaces hold hundreds of thousands of rows (inferred, not
  load-tested).

### Technical debt

- Two copy-pasted `Toggle` components (the knob bug existed twice).
- `lib/queries.ts`, `queries3.ts`, `queries4.ts` — split by build phase rather
  than domain.
- Client tests cover utilities only; no page/form tests; the Playwright checks
  used during the responsive pass live outside the repo.
- PDF pagination for very long ledgers untested (open since Phase 4).

---

## E. Foundations the roadmap can reuse (don't rebuild these)

| Existing piece | Reuse for |
|---|---|
| `adjustment` transaction type + day closing | Account reconciliation (record differences as real transactions) |
| `RecurringTransaction` + `REMINDER_TYPES` (bill, subscription, rent, emi) | Bills & Subscriptions centre, subscription detector output |
| `Reminder` + scheduler | Central reminder engine |
| `Attachment` with optional `transactionId` | Document vault, receipt gallery |
| `importBatchId` + batch undo | Bank statement import |
| `idempotencyKey` | Imports, bulk actions, AI-drafted transactions |
| `verifyIntegrity` / `repairBalances` | Data Health Centre |
| `AuditLog` | Security centre, transaction timeline |
| `Workspace.isDemo` | Demo mode |
| `Workspace.gstin`, `businessName`, `fiscalYearStartMonth` | GST foundations, invoices |
| `Person.relationship` (customer/supplier) | Customer/vendor directory |
| `parseQuickEntry` (preview-only by design) | Quick Entry 2.0 and AI drafts |
| Soft delete + restore | Every new financial entity |

---

## F. Opportunities (summary — prioritised in the roadmap)

- **Automation** — category rules, subscription detection, recurring-pattern
  suggestions, budget/bill reminders from one engine.
- **AI** — read-only Q&A over the user's own data; drafts that go through the
  existing preview-then-confirm path; receipt extraction.
- **Everyday users** — a simplified Daily Money home, faster entry, bills
  centre, real global search.
- **Households** — shared workspaces with roles and private items.
- **Small business** — invoices/quotations, sales vs purchases, GST-ready data,
  inventory (later).
- **India-specific** — `dd/mm/yyyy` and Indian-number CSV parsing, UPI/bank
  statement formats, GST fields, Hindi first.

---

## G. Scalability concerns

- Membership and privacy flags will touch query paths broadly — the single
  `requireWorkspace` choke point is what keeps that tractable.
- Group expenses and splits must stay outside the posting validator.
- The scheduler iterates **every workspace** each tick (`scheduler.service.ts`);
  fine now, needs batching/queueing at large user counts.
- The notifications TTL (90 days) means notification history isn't an audit
  trail — keep security events in `AuditLog`.
