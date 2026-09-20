# Khata — Architecture

> **Khata** (खाता) — the Indian word for a ledger/account book. A premium cash book,
> personal ledger and personal-finance system built for daily real-world use.

---

## 1. High-level shape

```
┌──────────────────────────────────────────────────────────────────┐
│  client/  React 19 + TypeScript + Vite + Tailwind v4             │
│  ─ Zustand (session/UI state)  ─ TanStack Query (server state)   │
│  ─ React Hook Form + Zod       ─ Recharts  ─ Lucide              │
│  ─ IndexedDB outbox (offline-first, phase 4)                     │
└───────────────────────────┬──────────────────────────────────────┘
                            │ REST /api/v1  (JWT access token in memory,
                            │                refresh token in httpOnly cookie)
┌───────────────────────────┴──────────────────────────────────────┐
│  server/  Node 24 + Express 5 + TypeScript                       │
│  ─ modules/  (route → controller → service → model)              │
│  ─ Zod validation at the edge                                    │
│  ─ Mongoose 8 + MongoDB (replica set → multi-doc transactions)   │
│  ─ Pino logging, Helmet, rate limiting, audit log                │
└──────────────────────────────────────────────────────────────────┘
```

Monorepo via **npm workspaces**. One `npm install` at the root installs both.

---

## 2. Non-negotiable invariants

These are the rules the whole system is built around. Everything else is negotiable.

| # | Invariant | Enforced by |
|---|-----------|-------------|
| I1 | **Money is never a float.** All amounts are integer *minor units* (paise for INR). | `lib/money.ts`, Mongoose `amountMinor: Number` with integer validator |
| I2 | **An account balance is derived, never authoritative.** `balance = openingBalance + Σ(signed postings)`. A cached `cachedBalanceMinor` exists only as a read optimisation and is always recomputable. | `services/balance.ts` + `recomputeAccountBalance()` |
| I3 | **Every transaction produces one or more immutable postings.** A posting is `(account, signedAmount)`. Postings for one transaction always sum correctly for their type. | `Posting` subdocs on `Transaction` |
| I4 | **A transfer is one transaction with two postings** (−A, +B), never two transactions. It can never be double-counted, orphaned or half-deleted. | Single-document atomicity |
| I5 | **Transfers never touch income, expense or savings rate.** | `TxnType.TRANSFER` excluded from all income/expense aggregates |
| I6 | **Lending/borrowing is not income or expense.** It moves cash *and* creates a receivable/payable. | `TxnType.LEND/BORROW/...` excluded from income/expense aggregates; feeds net worth instead |
| I7 | **Nothing is hard-deleted.** Soft delete (`deletedAt`) keeps history recoverable and makes UNDO trivial. | `deletedAt` + global query filter |
| I8 | **Data is scoped to `(userId, workspaceId)` on every single query.** | `requireWorkspace` middleware + compound indexes; no query is ever written without both |
| I9 | **Multi-step financial writes are atomic.** Settlements and repayments that touch several documents run in a DB session/transaction when the server supports it, with a documented single-document fallback. | `withTransaction()` helper |

---

## 3. The transaction engine

### 3.1 One model, seven behaviours

There is exactly **one** `Transaction` collection. The `type` discriminates behaviour;
the `postings[]` array carries the actual money movement. This is what keeps the
ledger mathematically closed.

| Type | Postings | Person leg | Counts as income | Counts as expense |
|------|----------|:----------:|:----------------:|:-----------------:|
| `income` | `+amount` on account | – | ✅ | – |
| `expense` | `−amount` on account | – | – | ✅ |
| `transfer` | `−amount` on `from`, `+amount` on `to` | – | – | – |
| `lend` | `−amount` on account | `+amount` receivable | – | – |
| `borrow` | `+amount` on account | `+amount` payable | – | – |
| `repayment_given` | `−amount` on account | `−amount` payable | – | – |
| `repayment_received` | `+amount` on account | `−amount` receivable | – | – |
| `adjustment` | `±amount` on account | – | – | – |

`adjustment` exists for opening balances, daily-closing cash differences and
imprest corrections — so that *every* balance change has a traceable row, and no
balance is ever silently rewritten (spec §72).

### 3.2 Why postings instead of a single `accountId`

A transfer needs two accounts. Modelling it as `accountId` + `toAccountId` works
until you want a running balance per account, and then every query needs a
`$or`. With postings the account ledger is one clean query:

```js
Transaction.find({ workspaceId, 'postings.accountId': id, deletedAt: null })
```

and the running balance is a single ordered scan. It also makes the double-column
cash book (§10) fall out for free: cash column = postings on cash accounts, bank
column = postings on bank accounts, and a contra entry naturally appears in both.

### 3.3 Person ledger sign convention

One number, one meaning, no ambiguity:

```
personBalanceMinor  >  0   →  they owe you   ("You will receive")
personBalanceMinor  <  0   →  you owe them   ("You need to pay")
personBalanceMinor  =  0   →  settled
```

`lend` and `repayment_given` push it **up**; `borrow` and `repayment_received`
push it **down**. Like account balances, it is derived from the ledger entries and
never trusted as stored state (I2).

---

## 4. Module layout (server)

Each feature is a folder with the same four files, so navigation is boring and
predictable:

```
modules/<feature>/
  <feature>.routes.ts       Express router, auth/workspace middleware, rate limits
  <feature>.controller.ts   HTTP in → HTTP out. No business logic.
  <feature>.service.ts      Business logic + DB. No `req`/`res`. Unit-testable.
  <feature>.schema.ts       Zod schemas — the single source of truth for the contract
```

Zod schemas are the contract: they validate at the edge *and* generate the
TypeScript types that the service layer consumes. Shared response shapes live in
`shared/` and are imported by the client, so a contract change breaks the build
rather than production.

---

## 5. Auth design

- **Access token** — JWT, 15 min, held in JS memory only (never `localStorage`,
  so XSS cannot exfiltrate a long-lived credential).
- **Refresh token** — opaque 256-bit random string, SHA-256 hashed at rest,
  `httpOnly` + `SameSite=Strict` cookie, 30 days, **rotated on every use**.
- **Reuse detection** — a refresh token may be used once. Presenting a rotated
  token revokes that token's entire family, which is the standard signal of theft.
- **Password hashing** — `scrypt` from Node's stdlib (N=2^15, r=8, p=1, 64-byte
  key, per-user 16-byte salt), stored as `scrypt$N$r$p$salt$hash`. Memory-hard,
  zero native dependencies, no build toolchain required on Windows.
- **Verification / reset tokens** — random, hashed at rest, single-use, expiring.

Routes are protected by `requireAuth` → `requireWorkspace`. The second one is what
enforces I8: it resolves the active workspace, confirms the caller owns it, and
puts `{ userId, workspaceId }` on the request. Services accept that scope as an
explicit argument — they cannot be called without it.

---

## 6. Workspaces (Personal / Business)

A user owns 1..n workspaces, each `mode: 'personal' | 'business'`. A workspace is
the hard boundary for accounts, transactions, people, categories, budgets and
reports — switching workspace swaps the entire dataset, and business-only
navigation (Petty Cash, Daily Closing, Customers, Suppliers) appears only in
business mode.

This is one collection-scoping decision that buys the whole "two apps in one"
requirement (§4) without any duplicated logic.

---

## 7. Client architecture

- **Server state** → TanStack Query. Cache keys are `[workspaceId, resource, params]`
  so a workspace switch invalidates cleanly.
- **Client state** → Zustand slices: `auth`, `ui` (theme, privacy mode, sidebar),
  `workspace`.
- **Design tokens** → CSS custom properties in `styles/theme.css`, consumed by
  Tailwind v4's `@theme`. Light and dark are two token sets; no component ever
  hardcodes a hex value.
- **Money rendering** → one `formatMoney()` used everywhere, Indian grouping
  (`₹1,25,000`), and a single `<Money/>` component that respects privacy mode so
  masking (§38) works globally without touching call sites.

---

## 8. Build phases

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Architecture, DB schema, auth, API skeleton, design system, app shell | ✅ |
| 2 | Transactions, accounts, cash book, personal ledger, people | ⏳ |
| 3 | Reports, charts, budgets, goals, recurring, reminders | ⏳ |
| 4 | Security hardening, backup, import/export, PDF, attachments, offline | ⏳ |
| 5 | Testing, performance, responsive polish, final UI pass | ⏳ |
