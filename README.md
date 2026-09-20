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
- **Natural-language quick entry** — type "Paid 250 for lunch yesterday" and
  review a pre-filled entry before saving
- **Personalizable dashboard** — reorder, hide, and restore widgets
- **CSV import/export, PDF statements, and full backup/restore**
- **Offline-first** — a service worker precaches the app shell and queues
  writes made while offline, syncing automatically on reconnect
- **Share** — send a balance summary via the OS share sheet, WhatsApp, or
  clipboard
- **Security** — JWT access tokens + rotating refresh tokens, optional PIN
  lock, session timeout, rate limiting, and a full audit log
- **Privacy mode** — mask every balance on screen with one tap
- **Light and dark themes**, fully responsive (desktop sidebar, mobile
  bottom nav)

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
| `npm run lint` | Run ESLint across the repository |
| `npm run seed` | Seed demo data into the server's database |

## Testing

```bash
npm test
```

Runs the automated suite across both workspaces — the server suite exercises
the transaction engine's correctness invariants (transfers never counted as
income, balances always traceable to postings, workspace data isolation,
attachment authorization, refresh-token rotation and reuse detection, and
more) against a real in-process MongoDB replica set, not mocks.

## Building for production

```bash
npm run build
```

Builds `shared` (typecheck only — it ships source, compiled inline by the
other two builds), then `server` → `server/dist/index.js`, then `client` →
`client/dist/`. The server refuses to start in production
(`NODE_ENV=production`) without a real `MONGODB_URI` and real JWT secrets —
it will not silently fall back to the development in-memory database.

## Deployment

See **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)** for the full guide,
including every environment variable required on each platform and why. The
supported target architecture is:

- **Frontend** → Vercel
- **Backend** → Render
- **Database** → MongoDB Atlas
- **Attachment storage** → Amazon S3 (local disk in development only)

If your frontend and API end up on different domains (the setup above), read
the "Cross-domain authentication" section of that guide before deploying —
one environment variable (`COOKIE_CROSS_SITE`) needs to be set correctly or
sessions will not persist.

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
- Rate limiting, keyed by user id where authenticated so it can't be dodged
  by rotating IPs.
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
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Production deployment: every environment variable, per platform, and why |
| [`docs/PHASE2_NOTES.md`](docs/PHASE2_NOTES.md) – [`PHASE5_NOTES.md`](docs/PHASE5_NOTES.md) | Development history and what was verified at each stage |

## License

This project does not currently declare a license — all rights reserved by
default. Add a `LICENSE` file if you intend to open-source or otherwise
license this project for others to use.
