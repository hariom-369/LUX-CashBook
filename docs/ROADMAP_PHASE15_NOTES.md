# Phase 15 — Offline Sync 2.0 — Verification Notes

Scope: [`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md#phase-15--offline-sync-20-p2).
**Partially complete — the infrastructure is done; adopting it across every
mutation is not.** See "What's deliberately not done".

## What shipped

- **The outbox accepts any mutation.** `OutboxItem.method` widened from the
  literal `'POST'` to `POST | PATCH | PUT | DELETE`, plus an optional `rev`
  and a `conflict` marker (`lib/offlineDb.ts`).
- **`submitOrQueue`** (`lib/offlineMutation.ts`) — the generic "save, or queue
  if offline" helper any call site can adopt. Real server rejections are
  rethrown, never queued.
- **A five-state sync machine** — Offline, Syncing, Needs attention, Synced,
  Online — derived in `useSyncState()` from one source of truth per
  ingredient (online flag, in-flight flag, conflict count, a brief
  "just synced" flag), not a separately stored sixth field. `OfflineBanner`
  renders all five.
- **Exponential back-off** replaces the flat 30-second poll: 5s doubling to a
  5-minute cap, started only after a transient failure, reset on success.
- **Conflicts are never silent.** Replay now treats `STALE_REVISION` as its
  own outcome (previously lumped with validation errors and discarded): the
  queued edit stays, the server's current version is fetched and attached,
  and `ConflictDialog` shows both sides field by field. Resolution is the
  user's explicit choice — *Keep mine* re-reads the server's latest `rev` and
  resubmits on top of it; *Discard mine* drops the edit.
  `resolveOutboxConflict` is a standalone function so the dialog doesn't need
  a second `useOfflineSync()` instance (which owns the connectivity listener
  and retry timer and must exist once).
- **Adopted by one new surface:** transaction edit (PATCH, with `rev`) and
  delete (DELETE) in `TransactionDetailSheet`. A queued delete shows no undo
  toast — nothing has happened server-side to undo.

## What's deliberately not done

- **~46 other files with ~88 other `api.post/patch/delete` call sites still
  fail outright when offline** instead of queueing. The helper makes each
  migration small and mechanical, but I did not do them in one pass; I also
  did not move the hook into `api.ts` as a silent global interceptor, because
  many callers need the created resource back (`await api.post(...)` then use
  `.id`) and a fabricated "queued" response would break them quietly.
- **The conflict dialog covers replayed offline edits only.** An *online*
  stale-revision save in the other 11 `rev`-aware forms still shows the
  server's message as a plain error, as before.
- The diff is generic (queued body fields vs same-named fields on the GET
  response); it doesn't resolve nested or renamed fields.
- No Background Sync API; replay stays main-thread, by the service worker's
  own design note.

## Verification

1. `npm run typecheck`, `npm run lint` — clean.
2. Client tests **86/86** (6 new, `offlineMutation.test.ts`: live success
   queues nothing; PATCH/DELETE queue with `rev` retained; real rejections
   are rethrown; discard; overwrite on the latest rev; a mid-resolve second
   conflict stays conflicted). Server untouched, 300/300.
3. `npm run build` — succeeds.
4. Not exercised in a real browser (the dev server points at live Atlas),
   and the hook's timer/back-off loop has no unit test — that gap is real.

## Update — wider adoption

Ten more edit screens now go through `useOfflinePatch` (a drop-in for
`api.patch` that queues offline): accounts, budgets, goals, recurring,
people, products, projects (form and status change), invoices and
quotations. Bulk delete on the transactions list queues per item too. Still
**not** queueable: every create other than Quick Add, most non-`rev`
actions (settle, contribute, replenish, closings), and online stale-revision
conflicts outside the offline replay path. The hook's retry timer still has
no unit test.

## Update 2 — online conflicts and back-off test

A stale revision hit while *online* on any `submitOrQueue` PATCH (all the
screens above plus transaction edit) no longer shows a bare error: the edit is
kept as a conflict with the server's current version attached, and the
banner's Review button opens the same dialog used for replayed edits. The
back-off schedule is now a pure function (`retryDelayMs`) with a unit test;
the surrounding timer wiring in the hook is still untested. Creates remain
non-queueing on purpose: without a server idempotency key a create queued
after an ambiguous network failure could be applied twice.

## Update 3 — wording localised, behaviour unchanged

No sync behaviour changed in this pass. The banner's counts ("Syncing 3 offline
entries…", "2 offline edits need your attention") and the sync toasts are now
whole-sentence plural keys in English and Hindi, and the toasts raised from the
hooks (`useOfflineSync`, `useOfflinePatch`) use `tNow()` so they follow the
signed-in language. `OfflineBanner.test.tsx` (new) covers hidden-when-online,
English pluralisation and the Hindi needs-attention state with its Review
button.

**Deliberately still true, as requested:** creates other than Quick Add do
not queue offline. A create queued after an ambiguous network failure (request
reached the server, response lost) could be applied twice on replay; only Quick
Add carries an `idempotencyKey` the server de-duplicates. Broader offline
creation needs a server-side idempotency key on every create endpoint first,
and is not started. Still not queueable: ~88 non-`rev` actions (settle,
contribute, replenish, closings, …). The retry timer inside `useOfflineSync`
(as opposed to the pure `retryDelayMs` function) still has no unit test.

## Update 4 — idempotent creates, offline creates enabled

The Phase 15 rule was "do not enable queued creates until duplicates are
impossible". They are now impossible by construction: a server-side
`Idempotency-Key` middleware (see [`OFFLINE_SYNC.md`](OFFLINE_SYNC.md)) makes
any write exactly-once per user and key, and only then were creates adopted by
the forms listed there (`hooks/useOfflineCreate.ts`). Tests: 10 server tests
(replay, concurrent duplicates, key reuse on another body/path/workspace,
per-user scoping, failed requests not cached, malformed keys) and client tests
for the key being generated, sent live, persisted with the queued item and
re-sent on replay. Browser-verified at both widths.

**Still not queueable, deliberately:** uploads, imports/restore, exports,
invitations and email-sending actions — they need the server's answer
immediately. **Not built:** a Background Sync API replay (main-thread replay
only, as before).
