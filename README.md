# Khata

**खाता — a premium cash book, personal ledger, and personal-finance system, built
for daily real-world use.**

Khata combines a cash book, a personal lending/borrowing ledger, an
income/expense tracker, a multi-wallet manager, and a small-business petty
cash book into one accurate, offline-capable application — for students,
salaried individuals, families, freelancers, shopkeepers, and small
businesses.

> **Accuracy over visual effects.** Every balance shown in the UI is
> mathematically traceable to the underlying transaction records. Transfers
> and loans are never counted as income or expense. Nothing is ever
> silently modified, double-counted, or lost — see
> [Core invariants](#core-invariants) below.

---

## Contents

- [Features](#features)
- [Device support](#device-support)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Available scripts](#available-scripts)
- [Testing](#testing)
- [Building for production](#building-for-production)
- [Deployment](#deployment)
- [Core invariants](#core-invariants)
- [Security](#security)
- [Documentation](#documentation)
- [License](#license)

---

## Features

- **Cash book** — single/double/triple-column ledger with contra entries
- **Personal ledger** — track who owes you and who you owe, with partial
  settlements and a full running-balance history per person
- **7-type transaction engine** — income, expense, transfer, lend, borrow,
  repayment given/received — with transfers and loans structurally
  incapable of being counted as income or expense
- **Unlimited accounts/wallets** — cash, bank, UPI, credit card, savings,
  investments — each with its own running balance
- **Budgets & savings goals** with live progress and threshold alerts
- **Recurring transactions & reminders** for bills and due dates
- **Reports** — category breakdowns, monthly comparison, net worth trend,
  borrow/lend summary, an annual summary, and more
- **Natural-language quick entry** — type "Paid 250 for lunch from HDFC" or
  "Rahul owes me 1200" and review a pre-filled entry before saving; whatever
  it could not work out is asked, never guessed
- **Daily Money** — an optional simple start screen: balance, today's spend,
  what is safe to spend, what is due, who owes whom
- **Personalizable dashboard** — reorder, hide, and restore widgets
- **CSV import/export, PDF statements, and full backup/restore**
- **Offline-first** — a service worker precaches the app shell and queues
  writes made while offline, syncing automatically on reconnect
- **Share** — send a balance summary via the OS share sheet, WhatsApp, or
  clipboard
- **Security** — JWT access tokens + rotating refresh tokens, optional PIN
  lock, session timeout, rate limiting, and a full audit log
- **Privacy mode** — mask every balance on screen with one tap
- **Light and dark themes**, and a responsive layout for phones, tablets,
  laptops and large displays in portrait and landscape — see
  [Device support](#device-support)

## Device support

One app adapts from a 320px phone to a 2560px display, in portrait and
landscape, in both themes — no separate mobile site and no device detection:

| Screen width | Layout |
|---|---|
| Phones (under 640px) | Top bar, bottom navigation with the full menu in a drawer, forms as bottom sheets, content in a single column (account cards in a swipeable row); wide tables scroll inside their card |
| Tablets (640–1023px) | Same navigation; cards and summary tiles move into two or three columns, and forms open as centred dialogs |
| Laptops and desktops (1024px and up) | Collapsible sidebar and a multi-column dashboard |

- Keeps clear of the notch and home indicator, including when installed as an
  app.
- Where the browser supports it (Chrome on Android), the on-screen keyboard
  resizes the page so a form's buttons stay visible, and the bottom bar steps
  aside while you type.
- No control depends on hover.
- Long names, descriptions and email addresses wrap or truncate; amounts are
  never truncated. (One known edge case with ₹10-crore-plus figures in narrow
  summary tiles is listed in the notes below.)

What was changed, the layout conventions to follow when adding screens, and
how it was verified: [`docs/RESPONSIVE_NOTES.md`](docs/RESPONSIVE_NOTES.md).

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS v4 |
| Frontend state | Zustand (client state), TanStack Query (server state) |
| Forms & validation | React Hook Form, Zod |
| Charts & icons | Recharts, Lucide |
| Offline | `vite-plugin-pwa` (custom service worker), IndexedDB (`idb`) |
| Backend | Node.js, Express 5, TypeScript |
| Database | MongoDB (Mongoose 8) — replica set for multi-document transactions |
| Auth | JWT access tokens + rotating httpOnly-cookie refresh tokens |
| File storage | Local disk (dev) or Amazon S3 (production) behind a common abstraction |
| Testing | Vitest (both workspaces), Supertest, Testing Library |
| Tooling | npm workspaces (monorepo), ESLint |

## Project structure

```
.
├── client/    React frontend (Vite)
├── server/    Express API (built with tsup)
├── shared/    Types, constants, and money/date utilities shared by both
└── docs/      Architecture notes, phase notes, and deployment guide
```

This is an **npm workspaces monorepo** — one install at the root sets up all
three packages. `shared` ships TypeScript source directly; both the client
(via Vite) and the server (via `tsup`) compile it inline, so there's no
separate build step or published package to manage for it.

## Getting started

### Prerequisites

- Node.js `>= 20.11`
- npm (the project uses npm workspaces — not yarn or pnpm)

No local MongoDB installation is required for development — see below.

### Install

```bash
git clone <this-repo-url>
cd khata
npm install
```

### Run it

```bash
npm run dev
```

This starts both the API and the frontend together:

- API → `http://localhost:4000`
- App → `http://localhost:5173`

Open `http://localhost:5173` and register a new account — onboarding walks
you straight into the dashboard.

**No `.env` file is required to start developing.** If `MONGODB_URI` isn't
set, the server automatically boots a temporary in-process MongoDB replica
set, and JWT secrets are generated at startup. Data does **not** persist
across restarts in this mode — see [Environment variables](#environment-variables)
below to connect a real database.

> **If you have a `server/.env` with `MONGODB_URI` set** (for example, one
> filled in while preparing a deployment), `npm run dev` connects to *that*
> database instead — the dev server loads the file. Comment the line out to
> get the throwaway in-memory database back before registering test accounts
> or experimenting.

> The offline-first service worker only registers against a **production
> build** — to test it, run `npm run build --workspace client` and then
> `npm run preview --workspace client` instead of the dev server.

## Environment variables

Every backend variable is documented in [`server/.env.example`](server/.env.example)
and in full detail in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), including
which ones are required in production and what happens if they're missing —
the server validates its configuration at boot and refuses to start with an
invalid or incomplete setup rather than failing later in a request.

The frontend reads one variable at build time:

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Base URL of the API's `/api/v1` routes. Defaults to a same-origin relative path, which only works when the frontend and API share an origin (e.g. behind the dev proxy). Required for a split-domain deployment. |

## Available scripts

Run from the repository root unless noted:

| Command | Description |
|---|---|
| `npm run dev` | Start the API and frontend together, with hot reload |
| `npm run build` | Build `shared`, then `server`, then `client`, in order |
| `npm start` | Start the built API server (`server/dist/index.js`) |
| `npm test` | Run the full test suite (server, then client) |
| `npm run test:server` / `npm run test:client` | Run one workspace's tests only |
| `npm run typecheck` | Type-check all three workspaces |
| `npm run lint` | Run ESLint across the repository (config: `eslint.config.mjs`) |

## Testing

```bash
npm test
```

Runs the automated suite across both workspaces — the server suite exercises
the transaction engine's correctness invariants (transfers never counted as
income, balances always traceable to postings, workspace data isolation,
attachment authorization, refresh-token rotation and reuse detection, and
more) against a real in-process MongoDB replica set, not mocks.

The test database is always that in-process replica set, but a local
`server/.env` is still loaded into the test process. If it sets
`COOKIE_CROSS_SITE` or `MONGODB_URI`, three tests that assert the defaults
(in `tests/auth.test.ts` and `tests/env.test.ts`) fail for that reason alone.
(The production-configuration tests in `tests/env.test.ts` set their own
complete baseline, so they are not affected.)

## Building for production

```bash
npm run build
```

Builds `shared` (typecheck only — it ships source, compiled inline by the
other two builds), then `server` → `server/dist/index.js`, then `client` →
`client/dist/`. The server refuses to start in production
(`NODE_ENV=production`) without a real `MONGODB_URI` and real JWT secrets —
it will not silently fall back to the development in-memory database. It also
refuses a configuration that would only fail later for real users: local file
storage (use S3), no `SMTP_HOST` or a placeholder `MAIL_FROM`, `localhost` or
non-https `APP_URL`/`API_URL`, or insecure cookies. Before deploying the
frontend, run `npm run check:deploy --workspace client` (it fails while
`client/vercel.json` still names the placeholder API origin in its CSP).

## Deployment

See **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)** for the full guide,
including every environment variable required on each platform and why. The
supported target architecture is:

- **Frontend** → Vercel
- **Backend** → Render
- **Database** → MongoDB Atlas
- **Attachment storage** → Amazon S3 (local disk in development only)

Serve the frontend and the API from one parent domain (`app.example.com` +
`api.example.com`) and leave `COOKIE_CROSS_SITE=false` — that is the supported
setup (see "Recommended: one parent domain" in the guide). A Vercel-domain +
Render-domain split needs `COOKIE_CROSS_SITE=true` and depends on third-party
cookies, which some browsers block; read "Cross-domain authentication" first.
The guide also lists the manual steps that cannot be done from this repository
(real S3, SMTP provider, Atlas user/network/backups).

## Core invariants

The application is built around a small set of non-negotiable rules —
enforced in the schema and service layer, not just the UI:

- Money is always an integer minor unit (paise), never a float.
- An account balance is always derived from its transaction postings, never
  stored as the source of truth.
- A transfer is one transaction with two postings that cancel exactly — it
  cannot be double-counted, orphaned, or half-deleted.
- Transfers and lending/borrowing are structurally excluded from every
  income/expense/savings calculation.
- Nothing is ever hard-deleted — soft deletes keep every history recoverable
  and make undo possible.
- Every query is scoped to `(userId, workspaceId)`, re-verified against the
  database on every request — a client-supplied ID is a request, never a
  grant.
- Multi-step financial writes (settlements, batch postings, restores) are
  atomic, using real database transactions where supported.

Full detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Security

- Passwords hashed with `scrypt` (Node's built-in implementation, no native
  dependencies).
- Short-lived JWT access tokens held only in memory on the client (never
  `localStorage`), paired with an opaque, rotating, httpOnly refresh token.
  Refresh-token reuse revokes the entire session family.
- Every workspace-scoped request re-verifies ownership against the database.
- Rate limiting, keyed by the verified user where authenticated (people behind
  one NAT do not share a bucket, and rotating IPs does not dodge it).
- Writes carry an `Idempotency-Key`, so a retried or offline-queued create can
  never produce a duplicate.
- Uploaded images are decoded and re-encoded or refused — never stored as
  received (HEIC, corrupt and non-image files are rejected).
- Production serves a strict Content-Security-Policy and the usual hardening
  headers (`client/vercel.json`); mail requires TLS; production dependencies
  have no known advisories (`npm audit --omit=dev`).
- Attachments are never publicly accessible — every download is
  authenticated and re-checked against workspace ownership, whether the file
  lives on local disk or in S3.
- Passwords, tokens, and cookies are redacted from all logs.
- Production error responses never include stack traces or internal detail.

Found a security issue? Please report it privately rather than opening a
public issue.

## Documentation

| Document | Covers |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design, the transaction engine, and every core invariant in detail |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Production deployment: every environment variable, per platform, and why — plus the recommended same-parent-domain setup, boot-time checks, and the manual steps (S3, SMTP, Atlas) still to do |
| [`docs/PHASE2_NOTES.md`](docs/PHASE2_NOTES.md) – [`PHASE5_NOTES.md`](docs/PHASE5_NOTES.md) | Development history and what was verified at each stage |
| [`docs/RESPONSIVE_NOTES.md`](docs/RESPONSIVE_NOTES.md) | The responsive / device-compatibility pass: what changed, layout conventions for new screens, what was verified, and known follow-ups |
| [`docs/PRODUCT_AUDIT.md`](docs/PRODUCT_AUDIT.md) | Product audit: feature inventory, user journeys, and findings (security, product integrity, data model, UX, accessibility) with evidence |
| [`docs/FEATURE_ROADMAP.md`](docs/FEATURE_ROADMAP.md) | Roadmap: decisions, phase order and per-phase impact, every feature rated by priority, complexity and value |
| [`docs/ROADMAP_PHASE1_NOTES.md`](docs/ROADMAP_PHASE1_NOTES.md) | What Phase 1 (truth, safety, foundations) shipped, the bugs it caught, and what was verified |
| [`docs/ROADMAP_PHASE2_NOTES.md`](docs/ROADMAP_PHASE2_NOTES.md) | What Phase 2 (everyday entry) shipped — transaction edit UI, payees, tags, category rules, Quick Entry 2.0, structured global search, the Daily Money home — and what was verified |
| [`docs/ROADMAP_PHASE3_NOTES.md`](docs/ROADMAP_PHASE3_NOTES.md) | What Phase 3 (bills, subscriptions, reminders) shipped — bills centre, subscription detector, calendar, browser push — and what was verified |
| [`docs/ROADMAP_PHASE4_NOTES.md`](docs/ROADMAP_PHASE4_NOTES.md) | What Phase 4 (lending 2.0) shipped — per-loan timeline, installment schedules — and what was already built before the phase started |
| [`docs/ROADMAP_PHASE5_NOTES.md`](docs/ROADMAP_PHASE5_NOTES.md) | What Phase 5 (bank import & reconciliation) shipped — column-mapping import, duplicate classification, account reconciliation — and what was verified |
| [`docs/ROADMAP_PHASE6_NOTES.md`](docs/ROADMAP_PHASE6_NOTES.md) | What Phase 6 (receipts & documents) shipped — receipt capture, document vault, expiry reminders — and the deliberate delete/restore behaviour change |
| [`docs/ROADMAP_PHASE7_NOTES.md`](docs/ROADMAP_PHASE7_NOTES.md) | What Phase 7 (planning & insight) shipped — credit card centre, forecast, budgets/goals 2.0 — report builder and reimbursements (added later), and what remains deferred |
| [`docs/ROADMAP_PHASE8_NOTES.md`](docs/ROADMAP_PHASE8_NOTES.md) | What Phase 8 (splits & groups) shipped, and a test-infrastructure bug it found and fixed — the suite had never exercised a real multi-document transaction |
| [`docs/ROADMAP_PHASE9_NOTES.md`](docs/ROADMAP_PHASE9_NOTES.md) | What Phase 9 (household workspaces) shipped — membership/roles, invitations, private accounts — a named gap in private-account coverage, and this phase's security review status |
| [`docs/ROADMAP_PHASE10_NOTES.md`](docs/ROADMAP_PHASE10_NOTES.md) | What Phase 10 (AI assistant) shipped — read-only tool-use for questions, draft extraction from text/receipts that always reviews through Quick Add — and why it ships untested against a real model (no provider key in this environment) |
| [`docs/ROADMAP_PHASE11_NOTES.md`](docs/ROADMAP_PHASE11_NOTES.md) | What Phase 11 (freelancer mode) shipped — invoices/quotations/projects built around the existing ledger, atomic number sequencing, and why "overdue" is derived rather than stored |
| [`docs/ROADMAP_PHASE12_NOTES.md`](docs/ROADMAP_PHASE12_NOTES.md) | What Phase 12 (business operations) shipped — combined invoice+loan receivables ageing, petty cash cash-counts, basic inventory with oversell protection, and a P&L composed from the existing category statement |
| [`docs/ROADMAP_PHASE13_NOTES.md`](docs/ROADMAP_PHASE13_NOTES.md) | What Phase 13 (GST-ready data) shipped — place-of-supply CGST/SGST vs IGST splitting, inclusive/exclusive pricing, HSN/SAC, and a GST summary report — no filing claims |
| [`docs/ROADMAP_PHASE14_NOTES.md`](docs/ROADMAP_PHASE14_NOTES.md) | What Phase 14 (Hindi/localisation) shipped — the language switcher, the completed UI string migration (with a CI guard) and server messages, month names and the signed-out screens (added in Update 4), and what is still English |
| [`docs/ROADMAP_PHASE15_NOTES.md`](docs/ROADMAP_PHASE15_NOTES.md) | What Phase 15 (offline sync 2.0) shipped — queueable edits/deletes, conflict dialog, back-off, server-side idempotency and queued creates — and which mutations still don't queue |
| [`docs/ROADMAP_PHASE16_NOTES.md`](docs/ROADMAP_PHASE16_NOTES.md) | Phase 16 (final polish) — shortcuts, bulk actions, demo workspace and a11y lint shipped; report caching and analytics deferred pending named decisions; the rest listed as open |
| [`docs/LOCALIZATION.md`](docs/LOCALIZATION.md) | How the in-house translation catalogue works, and the exact steps to add another language |
| [`docs/FINANCIAL_MODEL.md`](docs/FINANCIAL_MODEL.md) | The financial invariants and how a new feature must move money |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Authentication, authorization, data protection, image-upload rules, production headers, dependency advisories, auditability and account lifecycle |
| [`docs/OFFLINE_SYNC.md`](docs/OFFLINE_SYNC.md) | What works offline today, what changed in Phase 1, and what Phase 15 adds |

## License

This project does not currently declare a license — all rights reserved by
default. Add a `LICENSE` file if you intend to open-source or otherwise
license this project for others to use.
