# Phase 2 — Verification Notes

## What shipped

**Backend** (`server/src/modules/{accounts,categories,people,transactions,dashboard,cashbook}`)
- Full transaction engine: income, expense, transfer, lend, borrow, repayment_given/received, adjustment
- Postings-based ledger with atomic balance updates (`services/balance.service.ts`)
- Person ledger with partial repayment allocation, settle-account, oldest-debt-first repayment
- Traditional cash book: single/double/triple column views with contra entries
- Dashboard aggregation: totals, cash flow chart data, insights, upcoming items
- Ledger integrity checker + repair endpoint (`GET/POST /api/v1/integrity`)
- **74 automated tests passing** (`server/tests/{auth,money,ledger}.test.ts`), including the exact §68
  specification scenario and cross-user isolation checks

**Frontend** (`client/src/features/{dashboard,transactions,accounts,people,cashbook,onboarding,settings}`)
- Full design system (Button, Card, Money, Input, MoneyInput, Sheet, Toast, Badge, Icon)
- Validated chart palette (colour-vision-safe, see `dataviz` skill checks in `theme.css`)
- Dashboard, transaction list + quick-add + detail/undo, account ledger, person ledger,
  cash book, onboarding wizard, settings (profile/preferences/notifications/security/workspaces)

## Verified by

1. `npm run test --workspace server` — 74/74 passing
2. `npm run typecheck` on server and client — clean
3. `npm run build --workspace client` — succeeds
4. **Live browser walkthrough** via headless Chromium (Playwright): register → onboard →
   dashboard → quick-add income → transaction list → people → accounts → cash book →
   dark mode toggle. All screens rendered correctly with live data; balances matched
   across dashboard, transaction list, accounts and cash book.

## A bug the live walkthrough caught that tests didn't

The server test suite passes against an in-process instance created fresh per run, so it
never exposed this: a **stale server process from an earlier dev session** was still bound
to port 4123 and silently served old code (missing the Phase 2 routes), returning 404 for
every new endpoint while `/health` and `/api/v1/auth/*` still worked. Discovered by
`GET /api/v1/dashboard` returning `ROUTE_NOT_FOUND` in the browser despite the route
existing in source. Fixed by killing the stale process and confirming a single clean bind.
No code change was needed — this was purely an artifact of iterative background-process
management during development, not a defect in the application.

## Known follow-ups for later phases

- Chart bundle (`charts-*.js`) is ~380KB — will split further with lazy-loaded routes in
  the polish pass (§58).
- Client component tests are minimal (money/cn only) — Phase 5 adds RTL tests per feature.
- Quick-add doesn't yet support attachments (Phase 4) or natural-language entry (§46, Phase 3).
