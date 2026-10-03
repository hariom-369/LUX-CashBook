# Deployment

Target architecture: **Vercel** (frontend) + **Render** (backend API) +
**MongoDB Atlas** (database) + **Amazon S3** (attachment storage) + **GitHub**
(source).

This is a real cross-domain deployment: the frontend and API live on two
different registrable domains (e.g. `lux-cashbook.vercel.app` and
`lux-cashbook-api.onrender.com`). Two settings exist specifically because of
that — `COOKIE_CROSS_SITE` and `APP_URL`/`CORS_ORIGINS` — and getting either
wrong produces a specific, documented failure mode rather than a generic error,
so read those two sections even if you skim the rest.

## How the pieces fit together

- The **client** (`client/`) is a static Vite build. It has no server of its
  own in production — Vercel serves the built files directly.
- The **API** (`server/`) is a single Node process (`server/dist/index.js`
  after `npm run build`). Render runs it as a persistent web service, not a
  serverless function — the app keeps a live MongoDB connection pool and an
  in-process scheduler (recurring transactions, reminders), neither of which
  suits a cold-start-per-request model.
- `shared/` is not deployed anywhere on its own. It ships TypeScript source
  that both `client`'s Vite build and `server`'s `tsup` build compile inline
  into their own output — there is no `shared/dist` to deploy separately, and
  no step you need to add for it beyond the ordinary root build command.

## Required environment variables

### Backend (Render → your service → Environment)

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | Yes | Set to `production`. This flips on every production safety check below (secrets required, no in-memory DB fallback, stack traces hidden from error responses, HSTS enabled). |
| `PORT` | No | Render sets this itself and the app already reads `process.env.PORT` — do not hardcode it. |
| `HOST` | No | Defaults to `0.0.0.0`, correct for Render as-is. |
| `MONGODB_URI` | **Yes** | Your Atlas connection string (see Atlas section below). The server refuses to boot in production without this — verified: I ran the production build with `NODE_ENV=production` and no `MONGODB_URI` set, and it exited immediately with a clear error rather than starting insecurely. |
| `MONGODB_DB_NAME` | No | Defaults to `khata`. Only change if you want a specific database name inside the Atlas cluster. |
| `JWT_ACCESS_SECRET` | **Yes** | ≥32 random characters. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. The server refuses to boot in production without this. |
| `JWT_REFRESH_SECRET` | **Yes** | Same as above — generate a **different** random value, do not reuse the access secret. |
| `APP_URL` | **Yes** | The exact production URL of your Vercel frontend, e.g. `https://lux-cashbook.vercel.app`. This is the primary allowed CORS origin and the base URL used inside password-reset/verification emails. Get this wrong and the browser will block every API call from the frontend with a CORS error. |
| `CORS_ORIGINS` | No | Comma-separated extra allowed origins — useful if you also serve a custom domain (`https://app.luxcashbook.com`) alongside the default Vercel URL. |
| `API_URL` | No | Your Render service's own public URL, e.g. `https://lux-cashbook-api.onrender.com`. Used to build absolute links in emails/attachments. |
| `COOKIE_CROSS_SITE` | **Recommended: leave `false`** (same parent domain, see "Recommended: one parent domain" below). Set `true` only for a Vercel-domain + Render-domain split. | `true` makes the cookie `SameSite=None; Secure`, which depends on third-party cookies that Safari and some Chrome settings block. The server prints a warning at boot when it is `true`. |
| `COOKIE_SECURE` | No | Leave as `auto` (the default) — it resolves to `true` automatically in production, and `COOKIE_CROSS_SITE=true` forces it to `true` regardless. |
| `COOKIE_DOMAIN` | No | **Leave unset**, even on one parent domain: the refresh cookie is host-only on the API host and `SameSite=Strict` already sends it to same-site requests (verified, below). |
| `STORAGE_DRIVER` | **Yes — set to `s3`** | Switches attachment storage from local disk (which Render wipes on every deploy) to S3. **A production boot refuses `local`** unless `ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true` (only for a host with a persistent disk mounted at `STORAGE_DIR`). |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | **Yes, if `STORAGE_DRIVER=s3`** | See the AWS section below. The bucket and region are checked **at boot**; the two keys must be set together (or both omitted to use an IAM role). It never falls back to local storage. |
| `S3_ENDPOINT` | No | Only set this if using an S3-compatible service other than real AWS (R2, Spaces, MinIO). Leave unset for AWS S3 itself. |
| `MAX_UPLOAD_MB` | No | Defaults to 10. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | **No — SMTP is optional** | Leave `SMTP_HOST` unset and the server starts and runs normally; only email verification and password reset need it (see "Running without SMTP" below). When `SMTP_HOST` is set, the rest is validated at boot: a bare host name, a valid port, `SMTP_USER`/`SMTP_PASS` together, port 465 with `SMTP_SECURE=true` or port 587 with `SMTP_SECURE=false`. In production a non-`secure` connection **must** upgrade with STARTTLS (`requireTLS`) or the send fails; certificates are always validated. Empty values count as unset. |
| `MAIL_FROM` | Only with SMTP | When `SMTP_HOST` is set in production: an address on a domain verified with your mail provider (SPF/DKIM), e.g. `Khata <no-reply@example.com>`. The placeholder default is refused. Ignored without SMTP. |
| `APP_URL`, `API_URL` | **Yes** | Public `https://` URLs (used for CORS and links in emails). `localhost` or `http://` is refused at boot. |
| `RATE_LIMIT_*`, `LOG_LEVEL`, `ENABLE_SCHEDULER` | No | Sensible defaults already in place; see `server/.env.example` for what each controls. |

### Frontend (Vercel → your project → Environment Variables)

| Variable | Required | Purpose |
|---|---|---|
| `VITE_API_URL` | **Yes** | The full base URL of your Render API's v1 routes, e.g. `https://lux-cashbook-api.onrender.com/api/v1`. Without this the client falls back to a relative `/api/v1`, which only works when frontend and API share an origin — not the case here. |

Vite bakes `VITE_*` variables into the static build at build time, so set this
in Vercel **before** the first production build, and trigger a rebuild if you
ever change it afterward — it cannot be changed at runtime the way a backend
env var can.

## Cross-domain authentication

**The problem this fixes:** the refresh token lives in an httpOnly cookie
(`khata_rt`). Before this phase, that cookie was always set with
`SameSite=Strict`. A browser will not attach a `Strict` (or even `Lax`) cookie
to a cross-site request — and a Vercel domain calling a Render domain is a
cross-site request by definition, `fetch(..., { credentials: 'include' })`
included. The practical symptom would have been: login works, but the first
time the 15-minute access token expires or the page reloads, `/auth/refresh`
silently gets no cookie, the API correctly reports "not signed in," and the
user is bounced back to the login screen — repeatedly, on every reload.

**The fix:** `COOKIE_CROSS_SITE=true` switches the cookie to
`SameSite=None; Secure`, which browsers *do* send cross-site over HTTPS. Set
this in Render's environment for this deployment. Leave it `false` (the
default) for any future deployment where the frontend and API end up sharing
a domain — `Strict` is the more restrictive, preferable setting whenever it
actually works.

**Why this doesn't reopen CSRF risk**, since `SameSite=None` normally means
"add your own CSRF protection":
- The refresh cookie by itself grants nothing — the actual bearer access token
  used to authorize every ordinary API call lives in memory on the client and
  is sent via an `Authorization` header, which a third-party page cannot
  forge a browser into attaching (unlike a cookie).
- CORS still only allows the exact origins listed in `APP_URL`/`CORS_ORIGINS`.
  A request from any other origin fails CORS before the browser will expose
  the response to that page's JavaScript, even if the cookie were sent.
- The cookie is scoped to the `/api/v1/auth` path only, and rotates on every
  use with reuse detection (a replayed old refresh token revokes the entire
  session family) — both unchanged by this phase.

**What I did *not* change:** refresh-token rotation, reuse detection, access
token expiry (15 min), or JWT verification. I verified this by reading
`auth.service.ts` and `tokens.ts` again after the cookie change — none of that
logic touches `sameSite`/`secure`, which are cookie-transport settings, not
session logic.

**One thing to verify after deploying, that I could not test locally:** cookie
behavior in Safari/iOS with `SameSite=None` under stricter tracking-prevention
settings. It should work (`None; Secure` over HTTPS is the standards-compliant,
widely-supported configuration), but Safari's ITP has historically been the
most aggressive at trimming third-party storage, so test login persistence in
Safari specifically once deployed, alongside Chrome/Firefox.

## Attachment storage: local vs. S3

The storage layer was already built behind a `StorageDriver` interface
(`put`/`get`/`delete`/`exists`) before this phase — the S3 implementation adds
a second class satisfying that same interface; nothing in the attachment
routes, service, model, or the frontend changed. Switching is one environment
variable (`STORAGE_DRIVER`).

**What the S3 driver does:**
- Uploads with `ServerSideEncryption: AES256`, no ACL set on the object at all
  — the bucket's own "Block all public access" setting (see below) is what
  actually keeps files private, not a per-object flag that a future code
  change could accidentally omit.
- Every download still goes through the app's own authenticated
  `/api/v1/attachments/:id/download` and `/:id/thumbnail` routes, which
  re-verify the caller owns the workspace the attachment belongs to before
  reading anything from storage — identical to how local storage worked. No
  attachment is ever reachable via a raw S3 URL.
- Object keys are the same scheme as local storage:
  `<workspaceId>/<year>/<month>/<random-uuid>.<ext>` — never the user's
  original filename, so there's nothing to sanitize-and-get-wrong on the
  storage-path side, and no way to enumerate another workspace's files by
  guessing a name.

**Presigned URLs — considered, not wired in.** The driver includes a
`presignedGetUrl()` method (available for a future optimization), but no route
currently uses it — downloads still proxy bytes through the Express server, as
they always have. Reasoning: switching downloads to redirect to a presigned
URL would change the client's download contract (it currently expects
authenticated bytes back from a `fetch`, via `useAuthedBlobUrl`) for a
performance benefit that only matters at a scale this app isn't at yet — not
worth the invasive change under this phase's "preserve existing functionality,
no unnecessary architectural changes" constraint. Revisit this in Part 6's
scalability notes once attachment traffic volume justifies it.

### What you need to configure in AWS (manual — I cannot do this for you)

I have not created an AWS account, an S3 bucket, or any IAM credentials, and
this repository does not contain any. You'll need to:

1. **Create an AWS account** if you don't have one (aws.amazon.com).
2. **Create an S3 bucket** — pick a region close to your Render service's
   region to minimize latency. Bucket name must be globally unique.
3. **Block all public access** on the bucket (this is the default for new
   buckets — leave it on). The app never needs the bucket to be public.
4. **Create an IAM user** (or better, an IAM role if Render supports it in
   your setup — otherwise a dedicated IAM user) with a policy scoped to only
   this bucket and only the actions the app actually uses:
   `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:HeadObject` on
   `arn:aws:s3:::your-bucket-name/*`. Do not grant broader S3 access than that.
5. **Generate an access key** for that IAM user (Access key ID + Secret access
   key) and set them as `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` in Render's
   environment variables — never in code, never in the frontend, never
   committed to git.
6. Set `S3_BUCKET` and `S3_REGION` to match what you created.

I'm stopping here rather than guessing at bucket names, regions, or account
details — those are yours to choose.

## MongoDB Atlas

Not yet created — you'll need to:

1. Create a free or paid Atlas cluster (a free M0 cluster is a real replica
   set and is enough to start with — this app's multi-document transactions
   need a replica set, which M0 provides).
2. Create a database user (separate from your Atlas account login) with a
   strong, generated password.
3. Under Network Access, allow Render's outbound IPs — either add `0.0.0.0/0`
   (Atlas still requires the correct username/password/TLS, but this is the
   least restrictive option) or look up Render's static outbound IP ranges for
   your plan and allowlist those specifically instead, if you want to
   avoid a fully open network rule.
4. Copy the connection string Atlas gives you (`mongodb+srv://...`) and set it
   as `MONGODB_URI` in Render — with your real username/password filled in,
   not the placeholder Atlas shows you.

I have not created a cluster, a database user, or chosen a connection string —
there's nothing for me to invent here without your account.

## GitHub, Render, Vercel — what you'll set up

Covered in full with exact commands and dashboard steps in the Part 4
(GitHub) and final report (Render/Vercel) sections of this phase's chat
response — not duplicated here to avoid the two drifting out of sync. The
short version: push this repo to a new GitHub repository, then create a Render
web service and a Vercel project both pointing at it, each configured with the
environment variables tabulated above.

## Verifying a production boot without deploying

You can sanity-check the production boot path locally without touching any
real infrastructure:

```
cd server
npm run build
NODE_ENV=production node dist/index.js
```

**Caution:** `dotenv` loads `server/.env` first, so on a development machine that
file's real database URI is used unless the variable is already set in your shell.
Set `MONGODB_URI` to a dummy value (`mongodb://127.0.0.1:1/x`) for this check.
With no `MONGODB_URI`/JWT secrets set, this should immediately print a clear
configuration error and exit — confirmed working as of this phase. It will
not silently start with an in-memory database or generated secrets the way
development mode does.

### Recommended: one parent domain (`app.` + `api.`)

Put the frontend on `app.example.com` and the API on `api.example.com` (a Render
custom domain). Both are the same *site*, so the browser sends the refresh
cookie with `SameSite=Strict` and no third-party-cookie rule applies.

1. Vercel: add `app.example.com`. Render: add `api.example.com` (both give you
   the DNS records; both issue TLS certificates).
2. Render environment: `APP_URL=https://app.example.com`,
   `API_URL=https://api.example.com`, `COOKIE_CROSS_SITE=false`,
   `COOKIE_SECURE=auto`, leave `COOKIE_DOMAIN` unset.
3. Vercel environment: `VITE_API_URL=https://api.example.com/api/v1`.
4. Edit `client/vercel.json`: replace `https://api.example.com` in
   `connect-src` with your API origin, then run `npm run check:deploy
   --workspace client` (it fails while the placeholder is still there).

**Verified locally** (Chromium with fake hostnames mapped to 127.0.0.1, in-memory
API, `SameSite=Strict`): `app.khata.test` → `api.khata.test` keeps the session
across a reload (the `khata_rt` cookie is stored and `/auth/refresh` returns
200); `app.khata.test` → `api.other.test` does not (the cookie is rejected, the
reload lands on `/login`). That is the failure a Vercel-domain + Render-domain
split has, and it is why `COOKIE_CROSS_SITE=true` exists — but `SameSite=None`
additionally needs `Secure` and third-party cookies to be allowed; that part
cannot be verified without HTTPS on two real sites, so treat the single-parent
setup as the supported one.

### Running without SMTP

SMTP is optional. With `SMTP_HOST` unset (or empty) in production the server
starts and everything works except what exists only to send an email:

| Feature | Without SMTP |
|---|---|
| Password reset (`POST /auth/forgot-password`) | `503 EMAIL_NOT_CONFIGURED`: "The email service is not configured on this server, so this cannot be done right now. Please contact the administrator." The answer is the same for a registered and an unknown address, and no reset token is created. |
| Re-sending the confirmation email (`POST /auth/resend-verification`) | the same `503`; nothing is changed |
| Inviting a member to a workspace | the same `503`, before anything is created (the permission check still comes first) |
| Sign-up, sign-in, change password, everything else | unchanged. Accounts are simply created unconfirmed (nothing in the app is gated on a confirmed email). |
| Emailing a customer when an invoice is sent | skipped; the invoice is still marked sent |
| "Password changed" notices | skipped |

The people-facing consequence: **a user who forgets their password cannot reset
it by themselves** — the administrator has to deal with it directly. Turn SMTP
on whenever that matters. In development with no SMTP the emails (including the
links) are written to the server log instead, so the flows can still be tried.

### Production readiness (2026-10-03)

**What the server now refuses at boot in production**
(`config/productionChecks.ts`, tested): local storage without an explicit
persistent-disk opt-in; S3 without bucket/region or with half a key pair; an
incoherent SMTP setup *when `SMTP_HOST` is set* (bad host or port, wrong TLS mode
for the port, half a login, a missing or malformed `MAIL_FROM`); `localhost` or
non-https `APP_URL`/`API_URL`; `COOKIE_SECURE=false`. **A missing `SMTP_HOST` is
not refused.** It warns when
`COOKIE_CROSS_SITE=true`. Secrets (`JWT_*` ≥ 32 characters) and `MONGODB_URI`
were already required.

**Verified in this repository (local, in-memory DB; the real stack was not
available)**
- S3 driver over the real S3 wire protocol against an **S3 emulator (s3rver —
  not AWS)**: 3 MB put/get/exists/delete; API upload → objects in the bucket →
  API restart → bytes still there → download and thumbnail served from the
  bucket → a deleted attachment 404s; nothing written to local disk.
  Soft-deleted files stay in the bucket for the 30-day restore window and are
  purged afterwards.
- SMTP: registration verification and password-reset flows end to end through
  the browser to an authenticated SMTP sink; implicit TLS (465) works and a
  self-signed certificate is **refused**; STARTTLS is required in production.
- Frontend headers (`client/vercel.json`, also applied by `vite preview`): the
  full app (three browser suites, 1280 px and 390 px) runs under the CSP with
  **0 violations**; an injected inline script, an external image and an external
  `fetch` are blocked, and framing is refused.
- Atlas (read-only, plus a throwaway collection): TLS `mongodb+srv`, 3-member
  replica set (transactions work), the TTL index on `idempotencyrecords`
  exists (`createdAt`, 30 days) and the user *can* create TTL indexes.

**NOT verifiable without your accounts — manual steps**
1. **Real S3** (needs an AWS account): create a private bucket (Block all
   public access, default encryption) and an IAM user or role limited to
   `s3:PutObject`, `GetObject`, `DeleteObject` and `HeadObject` on
   `arn:aws:s3:::BUCKET/*`; set the four variables; upload a receipt, redeploy,
   and confirm it still downloads.
2. **Real SMTP — only if you want password reset and email confirmation** (a
   provider such as SES, Postmark or Resend): verify the sender domain (SPF +
   DKIM), set the variables, then register and reset a password with a real
   mailbox and check the message does not land in spam. Skip this step to run
   without email (below).
3. **A real deployment** on Render + Vercel + Atlas + S3: sign up → verify email
   → upload → backup/restore, in a real browser, at least once on a phone.
4. **Atlas hardening.** What this repository's connection actually has:
   `readWriteAnyDatabase@admin`. That is broader than needed. In Atlas →
   Database Access, create a dedicated user with the **`readWrite` role on the
   `khata` database only** (it includes create-index and create-collection,
   which the app's index sync and the idempotency TTL index need), put its URI
   in Render, and delete the broad user. In Network Access, replace any
   `0.0.0.0/0` entry with Render's outbound IP addresses (Render dashboard →
   your service → Connect → Outbound). Turn on **Cloud Backup** (a paid tier —
   the M0/M2/M5 shared tiers do not have it; this cluster's tier could not be
   read through the driver) and test a restore into a scratch cluster.
   **Rotate** the current user's password: the connection string has lived in a
   plain-text file on a development machine and has been used by test runs.
   (The network access list, backup status and tier are Atlas-console facts the
   database driver cannot show; nothing here claims them.)

**Still to do later:** upgrade the vitest toolchain (development advisories,
`SECURITY.md`); run a single API instance (the rate-limit store and the
scheduler are per process); attachment downloads are cached privately for an
hour, unlike the rest of the API.
