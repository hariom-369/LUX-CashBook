# Phase 10 — AI Assistant — Verification Notes

Scope: [`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md#phase-10--ai-assistant-p2-decisions-78),
decisions 7–8.

## What shipped

**Provider adapter with the same graceful-degradation contract as SMTP and
push** (`server/src/lib/ai.ts`): with no `ANTHROPIC_API_KEY` set, every AI
endpoint reports itself as "not configured" with a clean 400 rather than
crashing or faking a response — this environment has no real provider
credentials, so that steady state is exercised by the test suite and is the
expected state for anyone who hasn't opted in to the feature.

**Two distinct modes, deliberately kept apart:**

- **Ask** (`POST /ai/ask`) — a bounded (max 4 rounds), read-only tool-use
  loop. The model can only call six tool handlers
  (`server/src/services/aiTools.service.ts`), each a thin wrapper over an
  existing, already-tested service function — spending by category, net
  worth, budget status, people balances, bills due, cash-flow forecast.
  There is no tool that writes, and no tool that takes an id the model
  invented; every call re-runs the same `scope: RequestScope` filtering
  every other endpoint uses, so the assistant can never see more than the
  calling user already could through the ordinary API.
- **Draft** (`POST /ai/draft`, `POST /ai/draft/receipt`) — a single *forced*
  tool call that extracts a transaction shape (type, amount, description,
  date, a category/account guess) from free text or a receipt photo. It
  never auto-saves. Category and account name guesses are resolved
  (`resolveDraft` in `ai.service.ts`) only against the **calling user's own
  workspace data** — never an id the model produced directly — using a
  plain exact/prefix/substring match (`bestMatch`, unit-tested), not a
  fuzzy-distance score, so a near-miss is surfaced as an unmatched guess for
  the user to pick manually rather than silently landing on the wrong
  category. The resulting draft hands off to the **existing** Quick Add
  review screen via a new `ui.store` channel
  (`openQuickAddWithPrefill`/`consumeQuickAddPrefill`) — the same
  `ParsedQuickEntry` prefill the local natural-language quick-entry parser
  (§46) already used, so a misread amount or category is caught at the same
  review step a manually-typed entry goes through, never bypassed.

**Consent is opt-in and lives on the user, not the workspace**:
`User.preferences.aiAssistantEnabled` (default `false`). `GET /ai/status`
reports both whether the *server* has a provider key and whether *this
user* has opted in, and the client (`AssistantPage`) shows a plain
explanation — never the assistant UI itself — until both are true. Turning
it on is one toggle in Settings → Preferences, worded to say plainly that
enabling it sends relevant financial data to an external model.

**Client**: a new `/assistant` page (nav item, lazy-loaded like every other
route) with two cards — ask a question, or describe/photograph a
transaction for a draft. The draft card shows exactly what was and wasn't
matched before the user chooses to review it.

## Deliberate scope reductions from the roadmap's description

The roadmap sketch for this phase named a few things this pass did not
build, each a reasonable simplification rather than an oversight:

- **No `AiConsent` model.** The roadmap sketch named a dedicated model; this
  uses `User.preferences.aiAssistantEnabled` instead, consistent with every
  other per-user toggle (privacy mode, accounting view) already living
  there, and reusing the existing preferences-patch endpoint and merge
  logic rather than adding a parallel one.
- **No conversation log.** `/ai/ask` is stateless — nothing about a
  question or answer is persisted anywhere. This is a stronger privacy
  position than "off by default," not a weaker one, and can be added later
  if a real need for history surfaces.
- **Receipt extraction covers total, merchant/description, date and a
  category guess — not itemised line items or a separate tax figure.** The
  single-tool-call schema (`DRAFT_TOOL`) is shared between the text and
  receipt paths on purpose, so both produce the same reviewable draft shape;
  itemisation would need its own schema and its own review UI, and nothing
  in Quick Add today has anywhere to put line items.
- **No secondary AI-backed duplicate check behind Phase 5's deterministic
  matcher.** The existing matcher (exact amount + account + date window)
  remains the only duplicate detector. Layering an AI opinion on top of it
  is a real feature but a separate one, and risks adding false "possible
  duplicate" noise without a clearly better signal than what's there.

## Security posture

- Every tool handler takes the caller's own `scope` and only ever calls
  into existing, already-filtered service functions — reviewed for this
  specifically because §Phase 9's lesson (private-account writes slipping
  past a read-only check) is exactly the class of bug a tool-use layer
  could reintroduce if it ever called a service directly with a model-
  supplied id instead of going through the same scoped lookups.
  `extractDraftFromText`/`extractDraftFromReceipt` never take a category or
  account **id** from the model — only a **name**, resolved server-side
  against the caller's own data.
- Rate limited (`reportLimiter`: 30/minute) — a provider call is real cost
  and latency, same reasoning as the existing report/export endpoints.
- The receipt endpoint reuses the existing `multer` memory-storage +
  `env.maxUploadBytes` pattern from attachments; only `image/*` is
  accepted.
- No endpoint here can ever reach another user's or another workspace's
  data — `requireAuth` + `requireWorkspace` gate the router exactly like
  every other one, and a `viewer`-role member can use `/ai/ask` (a read)
  but not create a draft that matters, since drafts are never saved from
  the assistant anyway.

## Verification

1. `npm run typecheck` — clean (shared, server, client).
2. `npm run lint` — clean, repository-wide.
3. `npm test` — server 268/268 (10 new: status/consent behaviour, the
   "not configured" contract for `/ai/ask` and `/ai/draft`, and direct unit
   coverage of `bestMatch`'s exact/prefix/substring/no-match cases). Client
   78/78, unchanged — no client-side test added for `AssistantPage` itself,
   same reasoning as every feature-sheet since Phase 3: this codebase's
   convention covers components and `lib/` modules, not full pages wired to
   server state.
4. `npm run build` — succeeds; `AssistantPage` code-splits into its own
   ~4.7 kB chunk like every other route.
5. The actual tool-use loop and extraction prompts were **not** exercised
   against a real model in this environment — there is no provider key
   available here. Every test instead locks in the "not configured"
   contract, which is the state this feature ships in by default and the
   state most self-hosted instances will run in unless an operator opts in.
   Before relying on this in production with a real key, manually verify at
   least one real `/ai/ask` round-trip and one real `/ai/draft` extraction.

## Known follow-ups — next phase

- No conversation log — if usage ever shows a real need for "what did I
  ask last time," that's a deliberate addition, not a gap to silently fill.
- The AI-backed secondary duplicate check and itemised receipt extraction
  named in the roadmap sketch remain unbuilt; see "Deliberate scope
  reductions" above.
- Phase 11 (Freelancer/invoicing) is next per the roadmap.
