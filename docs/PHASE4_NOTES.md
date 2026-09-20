# Phase 4 — Verification Notes

## What shipped

**Backend** (`server/src/modules/{attachments,importexport,pdf,backup,pettycash,closing,audit}`)
- Attachments (§26): local file storage with path-traversal defence, image
  re-encoding + EXIF stripping + thumbnail generation via sharp, PDF pass-through,
  10MB cap, auth-gated download/thumbnail endpoints (never a public URL)
- CSV import/export (§34): template download, a preview step that validates every
  row against real accounts/categories before anything is written, batch-tagged
  imports that can be undone as one action, transaction export as a spreadsheet
- PDF statements (§35): account statements, person ledgers, and the cash book,
  built directly with PDFKit (no headless-browser dependency) with a consistent
  masthead/footer across all three
- Backup & restore (§40): a complete self-contained JSON snapshot of one
  workspace; restoring always creates a *new* workspace with every id remapped —
  never overwrites existing data — and balances are recomputed from the restored
  postings rather than trusted from the file
- Petty cash (§22): imprest float tracking on top of an ordinary cash account;
  replenishment always posts exactly the amount spent since the last top-up
- Daily/month closing (§32, §33): day closing computes the expected cash position
  purely from the ledger and records the difference against what was actually
  counted; month closing freezes a snapshot and blocks new writes into that period
  via the same `assertPeriodOpen` check the transaction engine already had,
  without ever touching a historical transaction
- Audit log endpoint (§42): the existing audit trail, exposed read-only to the user
- **10 new tests** covering CSV preview/commit/undo, a full backup→restore round
  trip with balance verification, petty cash replenishment math, day-closing
  difference calculation, month-closing period locking — **98/98 total passing**

**Frontend** (`client/src/features/{settings/DataSettings,business/*}` + attachment UI)
- Settings → Data: CSV export, import (upload → preview with per-row errors →
  commit → undo), backup download, restore upload with a workspace-name field
- Settings → Security: app-lock PIN setup/removal (password-confirmed) and a
  session-timeout selector
- A real lock screen (`PinLockScreen`) wired to an idle-timer hook (`useIdleLock`)
  that actually locks the UI after the configured inactivity period
- Business-mode pages: Petty Cash, Daily Closing, Month Closing, Customers,
  Suppliers (the latter two are the People feature pre-filtered by relationship —
  same ledger, same guarantees, business vocabulary)
- Attachment upload/preview/delete inline in the transaction detail sheet, and
  PDF/CSV export buttons on the account ledger, person ledger, and cash book pages

## A real bug caught before it shipped

`<img src>` and a plain `<a href>` cannot carry the `Authorization` header the
attachment and download endpoints require (deliberately — §69 keeps every file
behind auth rather than a guessable public URL). The first draft of the
attachment thumbnail list used a raw `<img src>` pointing at the API, which would
have rendered as a broken image for every user. Caught while writing the
component, not by a test — fixed by adding `useAuthedBlobUrl`, a hook that fetches
the authenticated bytes and hands the browser a local object URL, and reusing the
same pattern (`lib/download.ts`) for every PDF/CSV/backup download button.

## Verified by

1. `npm run test --workspace server` — 98/98 passing
2. `npm run typecheck` on server and client — clean
3. `npm run build --workspace client` — succeeds
4. **Live browser walkthrough**: registered as a business workspace → confirmed
   business-only navigation (Petty Cash, Customers, Suppliers, Daily/Month
   Closing) appears → downloaded the CSV import template through a real browser
   download event → set up petty cash on a fresh account and saw the correct
   "fully spent against the float" state → visited daily/month closing and both
   party pages → set an app-lock PIN with password confirmation and saw the
   session-timeout control appear. No console errors beyond expected pre-auth 401s.

## Configuration added

- `STORAGE_DRIVER` / `STORAGE_DIR` / `MAX_UPLOAD_MB` (already documented in
  `server/.env.example` from Phase 1) now actually back the attachment upload path.
  `STORAGE_DRIVER=s3` is accepted by config but intentionally not implemented —
  requesting it fails loudly at first use rather than silently no-op'ing.

## Known follow-ups for later phases

- Offline-first (§39) is not yet implemented — Phase 5 covers it alongside the
  broader performance and responsive polish pass.
- The chunk-size warning from Phase 2/3 notes still applies; addressed in Phase 5.
- PDF generation has no page-break-aware table repagination test beyond visual
  inspection — acceptable for now given PDFKit's built-in page overflow handling
  (`ensureSpace`), but worth a dedicated test with a very long ledger in Phase 5.
