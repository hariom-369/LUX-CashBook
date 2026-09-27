# Security

What Khata does today to protect an account and its data, and the rules for
extending it. The README's [Security](../README.md#security) section is the
one-page summary; this is the detail, plus what changed in Phase 1
([`PHASE1_NOTES.md`](PHASE1_NOTES.md)).

## Authentication

- Passwords hashed with Node's built-in `scrypt` (`lib/password.ts`) — no
  native dependency.
- A short-lived JWT access token, held only in a module-scoped variable on the
  client (`client/src/lib/api.ts`) — never `localStorage`, so it can't be read
  by an injected script and dies with the tab.
- A long-lived, rotating, httpOnly refresh token in a cookie the client JS
  never sees. Rotation is single-flight (concurrent 401s queue behind one
  refresh) and reuse of an already-rotated token revokes the entire session
  family (`modules/auth/auth.service.ts`).
- Login lockout: 8 failed attempts locks the account for 15 minutes
  (`User.failedLoginAttempts` / `lockedUntil`).
- App-lock PIN (§37): a second, lighter factor that re-locks the UI after
  inactivity without ending the session. *(Phase 1)* 5 wrong PINs locks PIN
  unlock for 15 minutes (`pinFailedAttempts` / `pinLockedUntil`) — the full
  password always still works, and the lock applies only to the PIN, never to
  the account itself.

## Authorization

- Every workspace-scoped route resolves `req.scope` via
  `middleware/auth.ts#requireWorkspace`, which re-verifies ownership against
  the database on every request. A client-supplied workspace id is a request,
  never a grant — the same 404 is returned whether a workspace doesn't exist or
  belongs to someone else, so existence can't be probed.
- Every service function takes that scope and filters by it; there is no
  internal path that reaches another user's data.
- Rate limiting is keyed by user id where authenticated (not just IP), so it
  can't be dodged by rotating IPs against one account.

## Data protection

- API responses carry `Cache-Control: no-store` (`server/src/app.ts`) —
  financial data is never eligible for the browser's HTTP cache. *(Phase 1)*
- The client's own caches (the service worker's API cache, the IndexedDB read
  cache) are wiped on sign-out and before every fresh sign-in
  (`client/src/lib/offlineDb.ts#wipeCachedReads`) — closes the gap where a
  previous user's balances stayed readable on a shared device. *(Phase 1)*
- The offline write queue (unsynced Quick Add entries) is tagged with the id
  of the user who queued it and is only ever replayed by that user's session —
  never shown to, or sent as, anyone else's. *(Phase 1)*
- Privacy mode (§38): `<Money>` doesn't just blur a figure with CSS — when on,
  the real digits are replaced in the rendered text and the accessible name
  says "Amount hidden," so a screen reader, DOM inspection or copy-paste can't
  recover a value that's supposed to be hidden. *(Phase 1)*
- CSV export/import escapes any cell beginning `= + - @` or a tab/CR with a
  leading `'` (`server/src/lib/csv.ts`) and reverses it on import — closes
  formula-injection (a description like `=HYPERLINK(...)` executing when the
  export is opened in a spreadsheet). *(Phase 1)*
- Attachments are never publicly reachable — every download is authenticated
  and re-checked against workspace ownership, on local disk or S3. Deleting
  the last reference to a file (including deleting the whole account) deletes
  the stored object, not just its database row. *(Phase 1, account deletion)*
- Passwords, tokens and cookies are redacted from every log line.
- Production error responses never include a stack trace or internal detail.

## Auditability

- `AuditLog` records every financial and security-relevant action (created,
  updated, deleted, restored, settled, login, logout, password changed,
  backup restored, …), scoped to the workspace, with actor IP/user-agent and
  never a secret.
- *(Phase 1)* A user's own account-level events (sign-in, password/PIN
  changes, signing out everywhere) are now surfaced to them — Settings →
  Security → Recent activity — reading the same `AuditLog` the server always
  wrote, filtered to `entityType: 'User'` and that user's own rows only.

## Account lifecycle

- *(Phase 1)* Account deletion (§77) is reachable from Settings → Security. It
  requires the current password and the typed word `DELETE`, matching what the
  API has always required. It purges every workspace's data (transactions,
  accounts, people, budgets, goals, recurring items, reminders, attachments —
  including the stored files themselves, not just their records), refresh
  tokens, notifications and the audit log, then the user document itself. This
  is the one genuinely irreversible action in the system.

## Environment and configuration

- The server validates its full configuration at boot (`config/env.ts`) and
  refuses to start with an invalid or incomplete one, rather than failing
  later inside a request.
- *(Phase 1)* Boolean environment variables and boolean query-string flags are
  parsed by a strict word-list (`lib/boolean.ts`,
  `middleware/validate.ts#queryBoolean`) — `true/false/1/0/yes/no/on/off`
  only. This closed a real bug: the previous `z.coerce.boolean()` treats *any*
  non-empty string as `true`, so `COOKIE_CROSS_SITE=false` (as `.env.example`
  ships it) silently meant `true`, and the client's own
  `?includeDone=false`/`?includeInactive=false` requests were silently
  ignored. Anything that isn't a recognised boolean word now refuses to boot
  (env) or is rejected with a validation error (a query flag), rather than
  being misread.
- `npm test` no longer loads a local `server/.env` — a developer's deployment
  config can no longer change what the test suite asserts (or, worse, point it
  at a real database). See the README's callout in "Testing" for the parallel
  caveat about `npm run dev`.

## Feature flags

*(Phase 1)* `shared/src/features.ts` defines the flag set; each defaults to
`false` unless a `FEATURE_*` env var enables it, and a workspace may also carry
its own overrides (`Workspace.featureOverrides`, validated against the known
flag names) layered on top for that workspace only. `GET /api/v1/features`
serves the resolved set — usable before sign-in (env defaults only) or, for a
signed-in caller with a resolvable workspace, with that workspace's overrides
applied. Nothing in a flag response is sensitive. Nothing is gated by a flag
yet; the mechanism exists for the modules later phases add behind one.

## Reporting a vulnerability

Please report it privately rather than opening a public issue.
