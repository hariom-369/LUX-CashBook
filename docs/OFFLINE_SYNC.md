# Offline Sync — Current State

What's built (Phase 5 of the original build, per [`PHASE5_NOTES.md`](PHASE5_NOTES.md)),
what changed in Phase 1, and the gap Phase 15
([`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md)) closes.

## What works offline today

- **Reads.** The service worker (`client/src/sw.ts`) precaches the app shell
  and, via `NetworkFirst`, caches GET responses for dashboard, accounts,
  transactions, people, categories, cash book, budgets, goals and reports (7
  days, 200 entries). A reload while offline renders from this cache.
- **Session.** `stores/auth.store.ts` keeps a last-known-session snapshot
  (user, workspaces, active workspace) in IndexedDB, kept current automatically
  via a `useAuthStore.subscribe()`. `bootstrap()` distinguishes "the server
  said no" (signs out) from "the server is unreachable" (`isOfflineSession:
  true`, keeps the cached session) — this is what stops a dropped connection
  from bouncing someone to the login screen.
- **One write path.** Quick Add is the only mutation that queues offline
  (`lib/offlineDb.ts`'s `outbox` store): a network failure there queues the
  request instead of erroring, with a "saved offline" toast. Every queued item
  carries the `idempotencyKey` it was built with, so replaying the queue after
  an interrupted sync is safe — the server recognises a repeat and returns the
  original transaction. `useOfflineSync` drains the queue in creation order the
  moment the browser reports a connection (plus a 30s poll as a fallback for a
  connection that reports "online" before it's actually reachable).
- Every other mutation (edit, delete, settle, everything outside Quick Add)
  simply fails offline today — this is the gap Phase 15 closes.

## Phase 1 changes

- **Per-user outbox on shared devices.** A queued item now carries the id of
  the user who queued it (`OutboxItem.userId`); `useOfflineSync` only ever
  lists, counts and replays the *signed-in* user's own entries. An item queued
  before this field existed (no `userId`) is still treated as belonging to
  whoever is signed in — matching the app's previous behaviour exactly, since
  before this change there was only ever one implicit owner.
- **Replayed into the right workspace.** A queued item is sent with an explicit
  `X-Workspace-Id` header set to the workspace it was recorded in, not
  whichever workspace happens to be active when the sync runs — previously,
  switching workspace before a sync could send an entry to the wrong ledger,
  where the server would reject it and it would be discarded as a "permanent"
  failure.
- **Sign-out wipes the read cache**, not just the session (`wipeCachedReads`,
  see [`SECURITY.md`](SECURITY.md)) — a security fix, but it also means a
  fresh sign-in on a device never renders from a previous account's cached
  reads even while still offline.
- **A `401`/`403` mid-sync no longer discards the queued item.** Previously
  any 4xx response other than a rate limit was treated as a permanent
  rejection and removed from the queue. An expired session while offline is
  not a problem with the *entry* — it's now left queued for the next
  successful sync, along with `408` (request timeout), instead of being
  thrown away.

## What Phase 15 ("Offline sync 2.0") adds

- Every mutation queueable, not just Quick Add creates — edits, deletes,
  settlements.
- Explicit sync states surfaced in the UI: Online, Offline, Syncing, Synced,
  Needs attention (rather than only a pending-count banner).
- A conflict screen: when an offline edit's `rev` (see
  [`FINANCIAL_MODEL.md`](FINANCIAL_MODEL.md#optimistic-concurrency-rev)) no
  longer matches by the time it syncs, show both versions and let the user
  choose — never silently overwrite, and never silently drop the offline
  edit either.
- Back-off on retry, rather than the current fixed 30s poll.

## Rules for anything that touches this

- A queued mutation must always be safe to replay — carry (or be paired with)
  an idempotency key, exactly like Quick Add does today.
- A permanent failure (validation/business-rule rejection) is removed from the
  queue and named to the user; a transient one (network, timeout, an expired
  session) stays queued.
- Never pretend an operation is durably synced when it's still local-only —
  the pending count and any future sync-state indicator must reflect reality.

## Update — exactly-once creates (Phase 15 follow-up)

Creates are no longer limited to Quick Add. The rule above ("safe to replay")
is now enforced by the server for *every* write, not only by Quick Add's own
duplicate check:

- **Server** (`middleware/idempotency.ts`, `IdempotencyRecord`): a request
  carrying an `Idempotency-Key` (8–128 letters, digits, `- _ . :`) is
  executed once per user and key. The first 2xx response is stored (30-day
  TTL) and replayed to any repeat, so a response lost on a flaky connection
  cannot create a second record. A repeat while the first is still running is
  answered "still being processed" (transient — the client retries); the same
  key on a *different* method, path, workspace or body is refused. Stored
  responses are scoped to the user.
- **Client**: `submitOrQueue` generates a key for a POST, sends it live, and
  stores the same key with the queued item, so a live attempt that reached the
  server and an offline replay of it cannot both create. `useOfflineCreate`
  gives each create form the same behaviour; adopted by Account, Budget, Goal,
  Recurring, Payee, Project, Product, Invoice, Quotation, Person, Group, group
  expense, lend/borrow and reminder forms.
- Browser-verified: a network drop, an account created offline ("saved on this
  device"), reconnect — exactly one account, still one after reload.

Not yet queueable (still fail while offline): actions that need the server's
answer before the screen can continue (file uploads, imports, restore, report
exports, invitations, anything that sends email). Listed in the Phase 15 notes.
