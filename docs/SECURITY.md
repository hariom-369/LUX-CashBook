# Security

What Khata does today to protect an account and its data, and the rules for
extending it. The README's [Security](../README.md#security) section is the
one-page summary; this is the detail, plus what changed in Phase 1
([`ROADMAP_PHASE1_NOTES.md`](ROADMAP_PHASE1_NOTES.md)).

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
  `middleware/auth.ts#requireWorkspace`, which re-verifies *membership*
  (`WorkspaceMember`, since Phase 9's household workspaces — not
  `Workspace.userId`, which stays as "the original owner" for display only)
  against the database on every request. A client-supplied workspace id is a
  request, never a grant — the same 404 is returned whether a workspace
  doesn't exist, belongs to someone else, or simply hasn't invited this user,
  so none of those three can be distinguished from outside.
- *(Phase 9)* Roles: owner, admin, member, viewer. A `viewer` is refused on
  anything but a read — enforced once, inside `requireWorkspace` itself, so
  every workspace-scoped route gets it without being changed individually.
  Only owner/admin manage members and invitations; only the owner promotes to
  admin, removes an admin, or has their own role changed at all (never, by
  anyone).
- *(Phase 9)* Invitations are token-based, hashed at rest the same way email
  verification and password reset already were (`lib/tokens.ts`), and
  accepting one requires the signed-in caller's own email to match the
  invitation's exactly — a mismatch is refused identically to a nonexistent
  invitation.
- *(Phase 9)* An account marked `private` is hidden from every workspace
  member except its creator everywhere the data is read or written: listing,
  direct access, transaction lists and exports, balances, dashboard, cash book,
  reports, budgets, goals, forecasts, loans, groups, closings, attachments,
  backups, imports, people balances (computed per viewer), audit trail and the
  scheduler. A transfer touching a hidden account is shown **masked** (only the
  visible leg) so a visible ledger still adds up; write paths 404 on hidden or
  masked entries. The ~65 query sites were found by searching, and
  `privateAccountLeaks.test.ts` (18 tests) probes each path with distinctive
  figures. This is visibility inside a household, **not encryption**: the data
  is stored in the clear and a member can infer from a masked line that a
  private account exists. There is no end-to-end encryption in this application.
- *(Phase 9)* A browser push subscription's `endpoint` is restricted to a
  host allowlist of known push services (FCM, Mozilla autopush, WNS) — the
  server POSTs to this URL verbatim on every notification, so an
  unrestricted URL would let any signed-in user turn the server into an
  SSRF proxy (`modules/push/push.routes.ts`).
- *(Phase 9)* Only the workspace owner can mint a new admin, whether by
  promoting an existing member or by inviting someone directly with
  `role: 'admin'` — both paths enforce the same rule
  (`member.service.ts`, `invitation.service.ts`).
- Every service function takes that scope and filters by it; there is no
  internal path that reaches another user's data.
- *(Phase 11)* Invoices, quotations and projects follow the same rule as
  every other collection — every lookup is scoped by workspace, and a
  transaction's optional `projectId` is validated the same way `payeeId`
  already was (reject if it doesn't belong to the caller's own workspace).
- *(Phase 12)* Inventory (`/products`) is gated by the existing
  `requireBusinessMode` middleware — the same gate petty cash and closing
  already use. Stock-out movements use a conditional atomic update that
  refuses to take a product's count below zero, the same class of defence
  `assertSufficientBalance` already provides for account balances.
- *(Phase 13)* GSTIN/state/HSN fields are ordinary optional fields on
  already-scoped models — no new authorization surface. No filing or
  return claims are made anywhere in the app.
- The refresh cookie is `HttpOnly`, `Secure` outside development, `SameSite=Strict`
  (one parent domain) or `SameSite=None; Secure; Partitioned` (cross-site mode, so
  browsers that block third-party cookies still keep the session), scoped to
  `/api/v1/auth`, and cleared with the same attributes everywhere it is cleared.
- Rate limiting is keyed by the *verified* bearer token's user id where there
  is one, and by IP otherwise, so people behind one NAT do not share a bucket
  and rotating IPs does not dodge a per-user limit (`rateLimitKey`). A
  forged or expired token falls back to the IP.
- *(Phase 15 follow-up)* Writes carrying an `Idempotency-Key` are exactly-once
  per user and key. Stored responses are scoped to the user, the key must match
  the same method, path, workspace and body, and only successful (2xx)
  responses are stored (30-day TTL), so a key cannot be used to read another
  user's response or to replay a different request.
- *(Phase 7)* The report builder accepts a closed, strict definition (allow-listed
  groupings and filters), never a query or a field name; it reuses the
  transaction list's filter, so it cannot reach more than the list can. Category
  rules are plain text compared with `includes` plus a manual word-boundary
  check — never compiled as a regular expression. Reimbursement tracking has no
  ledger effect and cannot be set on anything but an expense.

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

## Localised error text

The client replaces a recognised server sentence with the catalogue's
translation (`i18n/serverMessages.ts`); unrecognised text is shown unchanged.
Matching is on text the server itself wrote, never on user input, and the
translation is rendered as text, not HTML.

## Auditability

- `AuditLog` records every financial and security-relevant action (created,
  updated, deleted, restored, settled, login, logout, password changed,
  backup restored, …), scoped to the workspace, with actor IP/user-agent and
  never a secret.
- *(Phase 1)* A user's own account-level events (sign-in, password/PIN
  changes, signing out everywhere) are now surfaced to them — Settings →
  Security → Recent activity — reading the same `AuditLog` the server always
  wrote, filtered to `entityType: 'User'` and that user's own rows only.

## AI assistant

- *(Phase 10)* Off by default — `preferences.aiAssistantEnabled`. Every
  endpoint reports a clean "not configured" response rather than faking one
  when no provider key is set (`lib/ai.ts`), the same contract SMTP and push
  already follow.
- The assistant's read-only tools (`services/aiTools.service.ts`) each call
  an existing, already-scoped service function with the caller's own
  `RequestScope` — there is no tool that performs a write, and no tool that
  accepts an id produced by the model. Draft extraction
  (`modules/ai/ai.service.ts`) resolves a category or account **name**
  guessed by the model against the calling user's own workspace data only —
  never an id — and a draft is never saved from the assistant itself; it
  always hands off to the ordinary Quick Add review screen.
- Rate limited the same as reports/exports (`reportLimiter`, 30/minute) —
  a provider call is real external cost and latency.

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

## Dependency advisories (`npm audit`, 2026-10-03)

**Production dependencies: 0 advisories** (`npm audit --omit=dev`).

Fixed this round, each after reading the changelog for what Khata actually uses:
- **sharp 0.33.5 → 0.35.5** (high; libvips/libheif CVEs on image decoding).
  Breaking changes in 0.34/0.35 (Node ≥ 20.9, no install script, removed
  `failOnError` and `paletteBitDepth`, `format.jp2k` → `jp2`, AVIF tuning, a
  default input-channel limit) do not touch Khata, which only calls
  `sharp(buffer, { failOn: 'none' }).rotate().metadata().resize().jpeg()`.
  Verified on JPEG/PNG/WebP/AVIF/GIF, EXIF-rotated, truncated, garbage and empty
  input, then through the app (upload, thumbnail, download).
- **nodemailer 6.10.1 → 10.0.14** (high; SMTP command injection via
  `envelope.size` and the transport `name`, CRLF in `List-*` headers, an
  address-interpretation conflict, an OAuth2 TLS check). Breaking changes
  (Node ≥ 20, `NoAuth` → `ENOAUTH`, SES transports removed, TLS validation for
  remote content, TypeScript rewrite shipping its own types) do not affect
  `createTransport({ host, port, secure, auth })` + `sendMail`, which is all
  Khata uses; `@types/nodemailer` was removed. Verified over real SMTP (AUTH
  PLAIN) to a local sink: verification and reset emails delivered, links work,
  a CRLF in a subject does not create a header, an ambiguous address is
  quoted rather than split.
- **csv-parse 5.6.0 → 7.0.3** (moderate; prototype replacement via `columns`).
  Khata uses `parse(text, { columns: true, skip_empty_lines: true, trim: true })`
  from `csv-parse/sync` — no renamed option, same import path. One behaviour
  change: a header named `__proto__` is now kept as an *own* key instead of
  being dropped; rows are only read by the names the user maps, so nothing
  depends on it. `csvHostileInput.test.ts` pins this (headers `__proto__`,
  `constructor`, `prototype`, `__proto__.x`, a formula cell).
- **serialize-javascript 7.1.1 → 7.1.2** (low; build-time, via the PWA plugin),
  by `npm audit fix` without `--force`.

**Remaining: 6, all development tooling, none shipped in a build or loaded by
the running server:**

| Package (path) | Severity | Issue | Resolvable? |
|---|---|---|---|
| `vitest` (client 3.2.7, server 2.1.9) | critical | arbitrary file read/execute **when the Vitest UI server is listening**; path traversal in `@vitest/mocker` | Only by `vitest@5` (two major versions; also moves vite). Mitigation: never run `vitest --ui`/`--api`; tests here run headless. |
| `@vitest/coverage-v8` (server, 2.1.9) | critical (inherits `vitest`) | same | Same upgrade (`@5.0.3`). |
| `@vitest/mocker`, `vite-node` (under vitest) | moderate | inherited | Same. |
| `vite` nested under vitest (≤ 6.4.2) | high | dev-server file-read / `server.fs.deny` bypass (Windows), editor-launch hash disclosure | Same. The app's own `vite` is 6.4.3 and not flagged. |
| `esbuild` 0.27.7 (dev tooling) | moderate | a website can send requests to esbuild's *dev server* and read the response; file read on Windows | Needs esbuild ≥ 0.28.1 via a tooling major bump; affects only a running `esbuild --serve`/vite dev server on a developer machine. |

These cannot be exploited against a deployed Khata (no test runner, vite dev
server or esbuild server runs in production). They are a developer-machine
risk; treat a vitest 5 migration as its own change with its own test run.

## Image uploads

An uploaded image is **decoded and re-encoded, or refused** — never stored as
received (`attachment.service.ts`, `imageUploadSafety.test.ts`). The decoder must
find a JPEG, PNG or WebP inside the bytes whatever the upload claims; a damaged
or truncated file (`failOn: 'error'`), text/HTML/script, SVG, GIF, AVIF and HEIC
are refused with a clear message. HEIC is not accepted at all (the prebuilt
sharp has no HEVC decoder, and the file pickers list only JPEG/PNG/WebP so
phones convert on their own). The stored image is a bounded JPEG with EXIF
removed and orientation applied. PDFs are stored as-is but must start with
`%PDF-`; any other declared type is refused. The API's CSP (`sandbox`,
`default-src 'none'`) and `nosniff` still apply to every download as a second
layer.

## Production boot checks, headers and mail

- The server refuses to start in production with local storage (unless a
  persistent disk is declared), with an incoherent SMTP setup (only when SMTP is
  configured — SMTP itself is optional), with `localhost`/http public URLs, or
  with `COOKIE_SECURE=false` (`config/productionChecks.ts`). Without SMTP the
  features that need email answer `503 EMAIL_NOT_CONFIGURED` identically for
  registered and unknown addresses (no membership oracle) and create no token
  they could not deliver. Check messages name variables only; a credential is
  never printed.
- SMTP: certificates are validated, and in production a connection that is not
  already TLS must upgrade with STARTTLS (`requireTLS`) — otherwise credentials
  and mail could be read by anyone who strips the offer.
- Frontend (`client/vercel.json`, the same headers are served by
  `vite preview`): a Content-Security-Policy with `script-src 'self'` (no inline
  script — the theme bootstrap is `public/theme-init.js`), `object-src 'none'`,
  `frame-ancestors 'none'` and `connect-src` limited to the app, the API
  origin (`https://lux-cashbook-api.onrender.com`) and the two Google Fonts
  hosts (the service worker needs those to cache fonts); `manifest-src 'self'`;
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy` (camera only for the app, everything else off),
  `X-Frame-Options: DENY`, COOP `same-origin` and HSTS. `style-src` keeps
  `'unsafe-inline'` because React renders inline `style` attributes — the one
  relaxation. `npm run check:deploy --workspace client` fails on the placeholder
  API origin, a missing API origin, and any wildcard, bare-scheme, plain-http or
  unsafe script source; `src/config/csp.test.ts` pins the exact origins and fails on a second CSP
  definition anywhere in the client. `npm run build` also checks `dist/`, and
  the build fingerprints the headers into `index.html` so a header-only
  change cannot be hidden from installed browsers by the service worker's
  precache; `npm run check:live -- <url>` compares a deployed site's real
  headers with `vercel.json`.

## Reporting a vulnerability

Please report it privately rather than opening a public issue.
