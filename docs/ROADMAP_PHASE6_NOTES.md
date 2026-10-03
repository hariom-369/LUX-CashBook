# Phase 6 — Receipts & Documents — Verification Notes

Scope: [`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md#phase-6--receipts-and-documents-p1p2).
Built on the existing `Attachment` model (image/PDF upload, re-encoding and
thumbnailing via sharp, private authenticated downloads — all from the
original build) rather than a parallel `Document` collection: a document
vault item is just an `Attachment` with no `transactionId` and some extra
optional fields. No new upload pipeline, no new storage code.

## What shipped

**Receipt capture in Quick Add.** The attach-file control that previously
only existed on the transaction detail sheet (after saving) is now also in
Quick Add's "Add details" section — pick or photograph (`capture="environment"`
on phones) a receipt, and it uploads right after the transaction is created.
A failed upload never undoes the saved transaction; it surfaces as its own
toast ("saved, but the receipt could not be attached") so the entry is never
lost over a flaky photo upload.

**Document vault fields** on `Attachment`: `docType` (receipt, bill,
warranty, rent agreement, insurance, salary slip, ID document, other),
`title`, `expiryDate`, `tags`, `amountMinor`, and an optional `accountId` —
all optional, all additive. `transactionId` was already optional, so a vault
document with none of these needing a transaction was already representable;
it just had no UI and no search.

**Receipt gallery / document vault** (`/documents`): every attachment in the
workspace, not filtered to one transaction — searchable by title/file name,
filterable by type and tag, with an "Add document" flow for anything that
isn't a transaction receipt (a rent agreement, a warranty).

**Expiry reminders.** `syncDocumentReminders` (mirrors `syncLoanReminders`'s
upsert-by-`sourceKey` pattern exactly) raises a `document_expiry` reminder
14 days before a document's `expiryDate`, retired the moment the document is
deleted or its expiry date is cleared. Added `document_expiry` to
`REMINDER_TYPES` rather than overloading `custom`, matching how every other
reminder-worthy concept in this codebase already gets its own type.

## A deliberate behaviour change, not a bug

The roadmap asked for "download, delete **and restore**" in the gallery.
The existing `deleteAttachment` purged the stored file immediately on
delete — a restore was therefore structurally impossible, by original
design (the comment removed in this change said so explicitly: "a
soft-deleted attachment has no ledger meaning to preserve, and keeping
deleted files around indefinitely just accumulates storage with no
benefit"). To make restore real rather than cosmetic, delete is now a true
soft-delete (the file is kept), and a new scheduler job,
`purgeDeletedAttachments`, physically removes files only once they've been
deleted for more than 30 days — restore still works for up to a month, and
storage still doesn't grow forever. This is the one place this phase
changed pre-existing behaviour rather than only adding to it; flagged here
specifically because it wasn't simply additive.

## Verified by

1. `npm run typecheck` — clean (shared, server, client).
2. `npm run lint` — clean, repository-wide.
3. `npm test` — **293/293 passing** (server 215, up from 210: 5 new tests
   for document-type/tag/search filtering, restore within the grace window,
   purge respecting (and then crossing) the 30-day retention cutoff,
   cross-workspace isolation on both listing and restore, and the
   expiry-reminder lifecycle; client 78, unchanged). One pre-existing client
   test (`offlineDb.test.ts`, an IndexedDB outbox-ordering test untouched by
   this phase) failed once under full-suite timing load and passed cleanly
   on every other run, including immediately after in isolation — a
   pre-existing flake, not a regression from this phase's changes.
4. `npm run build` — succeeds; `DocumentsPage` code-splits into its own chunk.
5. All server tests ran against the in-process MongoDB replica set only.

## Known follow-ups — next phase

- No client-side test for `DocumentsPage` or `DocumentUploadSheet`, same
  reasoning as Phases 3–5: this codebase's test convention covers components
  and `lib/` modules, not full feature pages wired to React Query and file
  uploads. The filtering, restore, purge-window and reminder logic are fully
  covered server-side.
- OCR / receipt-data extraction is explicitly Phase 10 (AI) scope, per
  decision 8 in the roadmap — not attempted here.
- The pre-existing `offlineDb.test.ts` flake (see above) is unrelated to this
  phase but worth a look if it recurs — likely a same-millisecond ID tie
  under parallel test load.
