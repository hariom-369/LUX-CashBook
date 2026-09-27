# Khata — Feature Roadmap

**Status:** proposal, awaiting approval. Nothing here has been built. It is
grounded in [`PRODUCT_AUDIT.md`](PRODUCT_AUDIT.md); finding IDs (S-1, P-1, D-3…)
refer to that document.

**Direction:** from *digital cash book* to *personal and small-business money
operating system* — without replacing the engine, the data, or any working
flow. Every phase is additive, feature-flagged where it adds a module, and
ships only when `typecheck`, `lint`, `test` and `build` pass.

**Ratings used below**

| Priority | Meaning | Complexity | Meaning | Value | Meaning |
|---|---|---|---|---|---|
| P0 | Fix before new features | Low | Days, one layer | Low | Nice to have |
| P1 | High value, build next | Medium | 1–2 weeks, several layers | Medium | Noticeable for some users |
| P2 | Useful, build after P1 | High | Several weeks, new models or flows | High | Most users benefit |
| P3 | Optional / future | Very High | Cross-cutting, needs design review | Very High | Changes why people use Khata |

Complexity is a relative estimate for planning, not a commitment.

---

## 1. Decisions that need your approval

These shape the data model or bring in third parties. Each has a
recommendation; nothing that depends on them starts until you choose.

| # | Decision | Recommendation | Alternative | Why |
|---|---|---|---|---|
| 1 | **Split bills and group expenses** | Build them *around* the engine. A split = several ordinary transactions sharing a `splitGroupId`. A group expense you paid = one expense (your share) + one `lend` per participant (their shares), created atomically and linked by a `GroupExpense` record | Let a transaction hold many category lines | Keeps the one-or-two-postings rule and every existing invariant, report and test intact (D-1). "Dinner ₹2,400, my share ₹800" becomes expense ₹800 + receivables ₹1,600 — exactly what the ledger should say |
| 2 | **Optimistic concurrency** | Add an explicit `rev` counter to financial documents; updates send the `rev` they read; mismatch → `409 Conflict` | Keep last-write-wins | Prerequisite for safe offline edits and shared workspaces (D-4). Backfill `rev = 0`; old clients keep working until they opt in |
| 3 | **Payees / merchants** | New `Payee` model and an optional `payeeId` on transactions | Store merchants as `Person` | People carry a lending balance; "Jio" doesn't. Keeping them separate protects the person ledger's invariants (D-5) |
| 4 | **Household workspaces** | `WorkspaceMember` collection (owner/admin/member/viewer); `requireWorkspace` checks membership; privacy set per **account** (`private` accounts and their transactions visible to their owner only) | Per-transaction privacy flags | One middleware plus a review of 31 queries (D-2). Account-level privacy is enforceable in queries; per-row flags are easy to leak |
| 5 | **Feature flags** | `FEATURE_*` env defaults + per-workspace overrides, served by `GET /api/v1/features`; the client hides navigation for disabled modules | A third-party flag service | No dependency; flags double as progressive disclosure for "simple" vs "advanced" users |
| 6 | **Translations** | Typed in-house message catalogue using built-in `Intl` (plurals, numbers, dates); no dependency | `i18next` + `react-i18next` | Two languages first; the real cost is extracting strings, not the library. Can migrate later |
| 7 | **AI provider and data policy** | Server-side adapter to one LLM provider; **opt-in per user**; the model only calls read-only functions built on existing services; writes come back as drafts the user confirms through existing endpoints | Client-side AI; or no AI | Financial data leaves your infrastructure only for users who opt in, and the model can never write or query the database directly |
| 8 | **Receipt OCR** | Reuse the AI adapter's vision capability (opt-in); manual entry always available | Self-hosted OCR (weak on receipts); a cloud OCR API | One privacy review instead of two; best accuracy on crumpled Indian receipts |
| 9 | **Web push** | Implement with VAPID keys and a `PushSubscription` model (one small dependency, e.g. `web-push`) in Phase 3 — and hide the Push switch until then | Remove push entirely | P-1: a switch must not exist before the feature does |

---

## 2. Recommended order

Your 16-phase outline is followed with four deliberate changes:

1. **A "truth and hardening" Phase 1 comes first.** Fixes a critical data
   exposure (S-1) and removes settings that do nothing (P-1).
2. **Bank import and reconciliation move up** (your Phase 7 → 5). High value
   for Indian users, low risk, and it builds the duplicate-matching logic that
   the subscription detector and AI duplicate checks reuse.
3. **Group expenses and household move later** (your Phase 5 → 8 and 9). They
   carry the most authorization and data-model risk, and both depend on
   optimistic concurrency (decision 2) landing first.
4. **Translation starts as a foundation in Phase 1** (so new screens are
   written with message keys) and completes in Phase 14, instead of
   retrofitting everything at the end.

| Phase | Theme | Headline outcome |
|---|---|---|
| 0 | Audit | ✅ This document and `PRODUCT_AUDIT.md` |
| 1 | Truth, safety, foundations | ✅ No fake settings, no data left behind at sign-out, installable app, flags, lint, i18n scaffold, hidden features surfaced, optimistic concurrency — see [`PHASE1_NOTES.md`](PHASE1_NOTES.md) |
| 2 | Everyday entry | Quick Entry 2.0, payees, category rules, tags, real global search, Daily Money home |
| 3 | Bills and reminders | Bills & subscriptions centre, reminder engine, browser notifications, calendar |
| 4 | Lending 2.0 | Timeline, installments, reminder messages, statements |
| 5 | Import and reconciliation | Bank CSV mapping, Indian formats, duplicate detection, account reconciliation |
| 6 | Receipts and documents | Receipt capture in Quick Add, gallery, document vault with expiry reminders |
| 7 | Planning and insight | Credit card centre, net worth centre, cash-flow forecast, report builder, budgets/goals 2.0 |
| 8 | Splits and groups | Split transactions, group expenses, debt simplification |
| 9 | Household | Shared workspaces, roles, private accounts |
| 10 | AI | Q&A over your data, AI drafts, receipt extraction |
| 11 | Freelancer and invoicing | Clients/projects, invoices, quotations, customer/vendor directory |
| 12 | Business operations | Sales vs purchases, petty cash 2.0, inventory (basic), business reports |
| 13 | GST foundations | GST fields, tax-inclusive/exclusive pricing, tax summaries |
| 14 | Hindi and localisation | Full string extraction, Hindi, pluggable languages |
| 15 | Offline sync 2.0 | Every mutation queueable, conflict resolution UI, sync states |
| 16 | Final polish | Security, performance, accessibility pass; docs |

---

## 3. Phases in detail

Each phase lists what it touches. **Migration** means existing documents need
a backfill; *additive* means new optional fields or collections only.

### Phase 1 — Truth, safety, foundations *(all P0/P1)*

**Build**
- Wipe the service-worker API cache and the IndexedDB `cache`/`outbox` on
  sign-out and on user change; key cached responses per user (S-1).
- Privacy mode: when on, `<Money>` exposes "hidden amount" to assistive tech
  and renders a mask instead of the figure (S-2).
- Notification settings: make the server honour in-app and per-type switches;
  hide Email, Push and Monthly summary until their phases land (P-1).
- Accessible names on all settings switches (A-1); a focus trap and focus
  return for the mobile drawer (A-2).
- CSV export escapes values beginning `= + - @` (S-4).
- PIN: attempt counter with a short lockout (S-3).
- PWA: add 192/512px icons, a maskable icon, a favicon and an "Install Khata"
  prompt where supported (P-3).
- Tooling: install and configure ESLint so `npm run lint` runs; restore or
  remove `npm run seed`; stop tests from loading a local `.env` (S-5, P-4).
- Feature-flag service (decision 5) and the i18n scaffold (decision 6).
- Surface what's already built (P-2): Security centre (sessions + audit log),
  account deletion, Data health (integrity check/repair), custom reminders,
  and the hidden transaction filters (tags, amount range, attachments,
  outstanding).
- Optimistic concurrency groundwork (decision 2): `rev` on Transaction,
  Account, Person, Budget, Goal, Recurring.

| Impact | Detail |
|---|---|
| Database | Additive: `rev` (backfilled to 0), `pinFailedAttempts`/`pinLockedUntil` on User, `FeatureFlag` overrides on Workspace |
| API | Additive: `GET /features`; `rev` accepted and returned (optional for old clients); notification creation checks preferences |
| Frontend | Settings, Security centre, Data health screens; filter panel; privacy masking; drawer focus; PWA assets |
| Security | Closes S-1, S-2, S-3, S-4 |
| Migration | One idempotent backfill script for `rev` |
| Tests | Sign-out clears caches; preferences suppress notifications; `409` on stale `rev`; CSV escaping; PIN lockout; flags gate routes |

### Phase 2 — Everyday entry *(P1)*

- **Quick Entry 2.0:** amount-first, account-first and text-first entry. The
  parser adds account detection ("from SBI", "using UPI"), transfer
  from/to accounts, "Rahul owes me ₹1,200", and names what it couldn't work out
  ("Which account did you use?") rather than guessing. Still preview-only.
- **Payees** (decision 3) with default category and account.
- **Category rules:** "if description/payee contains *Jio*, suggest
  Telecom," shown with a confidence cue. The user confirms, corrects or saves
  it as a rule. History is never recategorised automatically.
- **Tags:** manage, rename and merge tags; tag filters and a tag report.
- **Global search:** the command palette searches transactions, people,
  payees and accounts, plus structured queries ("above ₹5000", "Zomato last 3
  months", "UPI expenses").
- **Daily Money home:** optional simplified start screen covering balance,
  today's spend, what's due, who owes whom, and safe-to-spend from the budget.

| Impact | Detail |
|---|---|
| Database | New `Payee`, `CategoryRule`; optional `payeeId` on Transaction; index on `payeeId` |
| API | `/payees`, `/category-rules`, `/search` (scoped, paginated); `POST /transactions` accepts `payeeId` |
| Frontend | Quick Add, palette, Transactions filters, Home |
| Security | Search is workspace-scoped and rate-limited; no regex built from raw input |
| Migration | None (all optional) |
| Tests | Parser cases incl. ambiguity; rules never mutate history; search isolation across workspaces |

### Phase 3 — Bills, subscriptions, reminders *(P1)*

- **Bills & Subscriptions centre** built on `RecurringTransaction` plus a
  `billKind` (electricity, rent, EMI, OTT…): due today, this week, this month
  and overdue, with autopay status.
- **Confirm-this-occurrence** flow for remind-only recurring items (U-3).
- **Subscription detector:** finds repeating payee + amount + cadence and
  offers Confirm, Ignore or Create bill. It never converts anything on its own.
- **Reminder engine:** one pipeline for bills, loans, documents, budgets and
  custom reminders. In-app first; browser notifications (decision 9); email
  once SMTP is configured. Notification previews never contain amounts or
  names unless the user opts in.
- **Financial calendar:** day, week and month views of bills, income, loans,
  recurring items and reminders.

| Impact | Detail |
|---|---|
| Database | Additive: `billKind`, `autopay` on RecurringTransaction; `PushSubscription`; `DetectorDismissal` |
| API | `/bills` (a view over recurring), `/detector/subscriptions`, `/push/subscribe` |
| Frontend | Bills centre, calendar, notification settings (push/email switches return) |
| Security | Generic notification text by default; VAPID keys in env |
| Migration | None |
| Tests | Detector precision on seeded patterns; no posting without confirmation; preference-gated delivery |

### Phase 4 — Lending 2.0 *(P1)*

- Timeline per loan (lent ₹10,000 → repaid ₹2,000 → repaid ₹3,000 →
  remaining ₹5,000).
- Installment schedules with due dates, feeding reminders.
- "Send reminder" via the OS share sheet or WhatsApp compose link — always a
  user action, never an automatic send.
- A professional statement PDF per person, plus attachments on loans.
- Interest stays out (see Phase 16, P3) until its accounting treatment is
  agreed.

| Impact | Detail |
|---|---|
| Database | New `InstallmentPlan` referencing a lend/borrow transaction; no change to repayment allocation |
| API | `/people/:id/timeline`, `/loans/:id/installments` |
| Frontend | Person ledger, loan detail |
| Security | Share text excludes other people's data |
| Migration | None |
| Tests | Installments never change settled amounts; timeline equals the ledger |

### Phase 5 — Bank import and reconciliation *(P1)*

- Column-mapping import (Date, Description, Debit, Credit, Amount, Balance,
  Reference), saved per bank. `dd/mm/yyyy` and Indian-grouped amounts parsed
  correctly (D-3).
- A preview that classifies every row as **New**, **Duplicate**, **Possible
  duplicate** or **Invalid**, with deterministic matching on amount, date
  window, reference and description similarity. Nothing is imported blindly;
  batch undo is kept.
- **Transaction reconciliation:** match statement rows to existing entries and
  confirm.
- **Account reconciliation:** compare Khata's balance with the real one; any
  difference is recorded as an `adjustment` transaction the user approves —
  never a silent change.

| Impact | Detail |
|---|---|
| Database | New `ImportProfile`; additive `reconciledAt`, `statementRef` on Transaction |
| API | `/import/preview` accepts a mapping; `/reconcile/:accountId` |
| Frontend | Import wizard, reconciliation screen |
| Security | Files parsed server-side with size limits; formula-safe re-export |
| Migration | None |
| Tests | Date/amount parsing matrix; duplicate classification; idempotent commit; adjustment equals the difference |

### Phase 6 — Receipts and documents *(P1/P2)*

- Attach or capture a receipt inside Quick Add, crop and compress.
- Receipt gallery with search, filters, download, delete and restore.
- **Document vault:** receipts, bills, warranties, rent agreements, insurance
  and salary slips, with type, date, amount, links to transactions or
  accounts, tags, and expiry reminders.

| Impact | Detail |
|---|---|
| Database | Additive fields on `Attachment` (docType, title, expiry, tags, accountId) — no new collection |
| API | `/documents` (list/filter over attachments) |
| Frontend | Quick Add attach, gallery, vault |
| Security | Existing private-download path; per-workspace storage quota |
| Migration | None |
| Tests | Cross-user access denied; expiry reminders fire once |

### Phase 7 — Planning and insight *(P1/P2)*

- **Credit card centre:** statement day, due day, minimum due, utilization,
  "payment due in 3 days." Card payments stay transfers, as they already are.
- **Net worth centre:** trend, allocation and liability breakdown on the
  existing net-worth report, with no double counting.
- **Cash-flow forecast:** 7/30/90-day projection from recurring items and
  known bills, always labelled as an estimate and never mixed into actual
  balances.
- **Report builder:** date/accounts/categories/tags/people/types → table,
  chart or summary; save, duplicate and export.
- **Budgets 2.0:** copy last month, projected spend, account-specific budgets.
  Zero-based and envelope modes are P3.
- **Goals 2.0:** on track, behind or ahead; optional "contribute" that creates
  a real transfer into the goal's linked account.
- **Reimbursements:** a status on expenses (pending → submitted → approved →
  paid), with the payout linked back.

| Impact | Detail |
|---|---|
| Database | Additive: `statementDay`, `dueDay`, `minimumDueMinor` on Account; `SavedReport`; `reimbursement` sub-document on Transaction |
| API | `/forecast`, `/reports/custom`, `/saved-reports`, `/accounts/:id/card-summary` |
| Frontend | New centres and report builder |
| Security | Report builder only uses allow-listed fields and aggregation shapes |
| Migration | None |
| Tests | Forecast never alters balances; custom report totals equal category report totals |

### Phase 8 — Splits and groups *(P2, decision 1)*

- Split one payment across categories (linked transactions, one bank line).
- Groups (trip, flatmates, family) with equal, unequal, percentage, shares,
  exact and itemised splits; who paid, who owes, who settled; debt
  simplification that only *suggests* settlements.

| Impact | Detail |
|---|---|
| Database | New `ExpenseGroup`, `GroupExpense`; optional `splitGroupId`, `groupExpenseId` on Transaction |
| API | `/groups`, `/groups/:id/expenses`, `/groups/:id/settle` — all built on `createTransaction` inside `withTransaction` |
| Frontend | Group screens, split editor in Quick Add |
| Security | Group members are People in the owner's workspace — no cross-account sharing until Phase 9 |
| Migration | None |
| Tests | Split parts sum exactly to the paid amount (paise rounding rule documented); group totals equal person ledgers; atomic rollback |

### Phase 9 — Household workspaces *(P2, decision 4)*

- Invite by email; roles Owner, Admin, Member and Viewer.
- Shared accounts, budgets, bills and goals; private accounts invisible to
  others; per-member attribution in the audit log.

| Impact | Detail |
|---|---|
| Database | New `WorkspaceMember`, `Invitation`; `visibility` on Account |
| API | `requireWorkspace` → membership + role; role checks on mutations; the 31 `userId` queries reviewed |
| Frontend | Members screen, role-aware UI, privacy badges |
| Security | **Highest-risk phase** — requires a dedicated authorization test suite and review before release |
| Migration | Create an owner membership for every existing workspace (idempotent) |
| Tests | Every route × every role; private-account leakage tests on lists, reports, search, exports and backups |

### Phase 10 — AI assistant *(P2, decisions 7–8)*

- Questions such as "How much did I spend on food last month?", "Who owes
  me?" or "What bills are due this week?" are answered by calling read-only
  functions over existing services, citing the figures they used.
- "Create a draft for ₹500 groceries" returns a draft that opens in the
  normal Quick Add preview.
- Receipt extraction (merchant, date, items, tax, total), always reviewed
  before saving.
- A secondary duplicate check behind Phase 5's deterministic matcher; never
  deletes.

| Impact | Detail |
|---|---|
| Database | `AiConsent` on User; optional conversation log (off by default) |
| API | `/ai/ask`, `/ai/draft` — no tool can mutate data |
| Frontend | Assistant panel, consent flow, draft review |
| Security | Opt-in, data minimisation, no notes sent unless needed, per-user rate limits, prompt-injection-safe tool design |
| Migration | None |
| Tests | Tool outputs match service results; drafts never persist without confirmation |

### Phases 11–13 — Business *(P2/P3, business workspaces only)*

- **11:** Freelancer mode (clients, projects, billable expenses, project
  profit). Invoices with number series, items, discount and tax, statuses from
  Draft to Cancelled, PDF, and share or email on user action. Quotations
  convert to invoices without duplicating data. Customer/vendor profiles
  extend today's People-based lists.
- **12:** Sales vs purchases, receivables/payables ageing, petty cash 2.0
  (cash count and daily report on top of day closing), basic inventory
  (products, SKU, stock in/out, low-stock alerts), business reports and P&L.
- **13:** GST-ready data: GSTIN, HSN/SAC, CGST/SGST/IGST, place of supply,
  inclusive/exclusive pricing and tax summaries. No filing claims.

Invoice payments post through the engine as ordinary income (or a
receivable settled by repayment), so every report stays consistent. These
phases add new models (`Invoice`, `Quotation`, `Product`, `StockMovement`,
`Project`); each gets its own design note before building.

### Phase 14 — Hindi and localisation *(P2)*

Extract every remaining string into the catalogue from Phase 1, translate to
Hindi, add a language switcher, and document how to add Gujarati, Marathi,
Bengali, Tamil, Telugu, Kannada, Malayalam or Punjabi. Numbers and dates go
through `Intl` with the Indian system by default.

### Phase 15 — Offline sync 2.0 *(P2)*

Every mutation can queue, not just Quick Add creates. Sync states are Online,
Offline, Syncing, Synced and Needs attention. Retry uses back-off, and a
conflict screen uses Phase 1's `rev` to show both versions side by side and
never overwrites silently.

### Phase 16 — Final polish *(P2/P3)*

A full accessibility audit (keyboard-only and screen-reader walkthroughs),
list virtualisation, report caching, bulk actions with confirmation, keyboard
shortcuts, a settings centre reorganisation, a demo workspace, contextual help,
privacy-first product analytics (opt-in, no amounts), loan interest (P3) and
investment holdings (P3).

---

## 4. Feature catalogue

Every feature from the brief, rated. **DB** — *none*, *additive* (optional
fields), *new* (new collection), *migration* (backfill needed).

### Foundations and trust

| Feature | Priority | Complexity | Value | Phase | DB |
|---|---|---|---|---|---|
| Wipe offline caches on sign-out (S-1) | P0 | Low | Very High | 1 | none |
| Privacy mode 2.0 (masked a11y text, hidden widgets) | P0 → P2 | Low → Medium | High | 1, 16 | none |
| Honest notification settings (P-1) | P0 | Low | High | 1 | none |
| Accessible switches, drawer focus trap | P0 | Low | High | 1 | none |
| CSV formula escaping | P0 | Low | Medium | 1 | none |
| PWA install (icons, prompt) | P1 | Low | High | 1 | none |
| ESLint, seed script, test isolation | P0 | Low | Medium | 1 | none |
| Feature flags | P0 | Low | High | 1 | additive |
| Optimistic concurrency (`rev`) | P1 | Medium | High | 1 | migration |
| Security centre (sessions + audit log) | P1 | Low | High | 1 | none |
| Account deletion screen | P1 | Low | Medium | 1 | none |
| Data health centre | P1 | Low | Medium | 1 | none |
| PIN lockout | P1 | Low | Medium | 1 | additive |

### Everyday money

| Feature | Priority | Complexity | Value | Phase | DB |
|---|---|---|---|---|---|
| Quick Entry 2.0 | P1 | Medium | Very High | 2 | none |
| Smart category engine + rules | P1 | Medium | High | 2 | new |
| Payee directory | P1 | Medium | High | 2 | new |
| Tags management + tag reports | P1 | Low | High | 2 | none |
| Global financial search | P1 | Medium | High | 2 | none |
| Daily Money home | P1 | Medium | High | 2 | none |
| Smart home actions (+Bill, Scan receipt) | P1 | Low | High | 3, 6 | none |
| Dashboard 2.0 widgets | P2 | Medium | Medium | 7 | none |
| Onboarding 2.0 (optional steps) | P2 | Low | Medium | 16 | none |
| Demo mode | P2 | Medium | Medium | 16 | none |
| Help / education | P2 | Low | Medium | 16 | none |

### Bills, reminders, calendar

| Feature | Priority | Complexity | Value | Phase | DB |
|---|---|---|---|---|---|
| Bills & subscriptions centre | P1 | Medium | Very High | 3 | additive |
| Confirm recurring occurrence | P1 | Low | High | 3 | none |
| Subscription detector | P2 | Medium | High | 3 | new |
| Reminder engine (unified, custom) | P1 | Medium | High | 3 | additive |
| Browser (web push) notifications | P2 | Medium | Medium | 3 | new |
| Email notifications | P2 | Medium | Medium | 3 | none |
| Notification centre categories | P2 | Low | Medium | 3 | additive |
| Financial calendar | P2 | Medium | High | 3 | none |

### Lending, groups, household

| Feature | Priority | Complexity | Value | Phase | DB |
|---|---|---|---|---|---|
| Lending timeline, reminders, statements | P1 | Medium | Very High | 4 | none |
| Installment schedules | P2 | Medium | High | 4 | new |
| Loan interest (opt-in) | P3 | High | Medium | 16 | new |
| Split transactions | P2 | Medium | Medium | 8 | additive |
| Group expenses + debt simplification | P2 | Very High | High | 8 | new |
| Household workspaces + roles + private accounts | P2 | Very High | High | 9 | new + migration |

### Import, reconciliation, data

| Feature | Priority | Complexity | Value | Phase | DB |
|---|---|---|---|---|---|
| Bank statement import (mapping, Indian formats) | P1 | High | Very High | 5 | new |
| Duplicate detection (deterministic) | P1 | Medium | High | 5 | none |
| Transaction reconciliation | P2 | High | High | 5 | additive |
| Account reconciliation (adjustment) | P1 | Medium | High | 5 | additive |
| Generic import adapters | P3 | Medium | Medium | 5+ | new |
| Export centre | P2 | Medium | Medium | 7 | none |
| Backup 2.0 (checksum, preview, partial) | P2 | Medium | Medium | 16 | none |
| Encrypted backups | P3 | Medium | Medium | 16 | none |
| Documented data format (portability) | P2 | Low | Medium | 7 | none |

### Receipts and documents

| Feature | Priority | Complexity | Value | Phase | DB |
|---|---|---|---|---|---|
| Receipt capture in Quick Add + gallery | P1 | Medium | High | 6 | none |
| Document vault + expiry reminders | P2 | Medium | High | 6 | additive |
| OCR / AI receipt extraction | P2 | High | High | 10 | none |

### Planning and analysis

| Feature | Priority | Complexity | Value | Phase | DB |
|---|---|---|---|---|---|
| Credit card centre | P1 | Medium | High | 7 | additive |
| Net worth centre | P2 | Low | Medium | 7 | none |
| Cash-flow forecast | P2 | High | High | 7 | none |
| Report builder + saved reports | P2 | High | High | 7 | new |
| Budgets 2.0 (copy, projected, per account) | P2 | Medium | Medium | 7 | additive |
| Zero-based / envelope budgeting | P3 | High | Medium | 16+ | additive |
| Goals 2.0 (on-track, real contributions) | P2 | Medium | Medium | 7 | none |
| Reimbursement tracking | P2 | Medium | High | 7 | additive |
| Insights 2.0 (descriptive only) | P2 | Low | Medium | 7 | none |
| Investment holdings (manual, provider-ready) | P3 | High | Medium | 16+ | new |
| Transparent finance metrics (no single "score") | P3 | Medium | Low | 16+ | none |

### AI

| Feature | Priority | Complexity | Value | Phase | DB |
|---|---|---|---|---|---|
| AI Q&A over own data (read-only tools) | P2 | High | High | 10 | additive |
| AI transaction drafts | P2 | Medium | High | 10 | none |
| AI duplicate assist (secondary) | P3 | Medium | Low | 10 | none |
| Automation engine (reviewable rules) | P2 | High | High | 2 → 16 | new |

### Business

| Feature | Priority | Complexity | Value | Phase | DB |
|---|---|---|---|---|---|
| Freelancer mode (clients, projects) | P2 | High | Medium | 11 | new |
| Invoicing | P2 | High | High | 11 | new |
| Quotations → invoice | P3 | Medium | Medium | 11 | new |
| Customer / vendor directory 2.0 | P2 | Medium | Medium | 11 | additive |
| Sales / purchases, business reports, P&L | P2 | High | High | 12 | additive |
| Petty cash 2.0 | P2 | Low | Medium | 12 | additive |
| Inventory (basic) | P3 | Very High | Medium | 12 | new |
| GST foundations | P3 | High | Medium | 13 | additive + new |

### Platform

| Feature | Priority | Complexity | Value | Phase | DB |
|---|---|---|---|---|---|
| Hindi + localisation framework | P2 | High | High | 1, 14 | none |
| Offline sync 2.0 + conflict UI | P2 | High | High | 15 | uses `rev` |
| Bulk actions (confirmed) | P2 | Medium | Medium | 16 | none |
| Keyboard shortcuts, sortable tables | P3 | Low | Low | 16 | none |
| Settings centre reorganisation | P2 | Low | Medium | 16 | none |
| Transaction timeline (audit history) | P2 | Low | Medium | 7 | none |
| Privacy-first product analytics | P3 | Medium | Low | 16 | new |
| Performance (virtualisation, report caching) | P2 | Medium | Medium | 16 | none |

### Deliberately not planned

- **Direct UPI or bank connections, or live market data** — only through a
  licensed provider (e.g. India's Account Aggregator framework) in a separate,
  approved project. Nothing in the UI will imply a connection that doesn't
  exist.
- **GST filing** — foundations only; no claims of official integration.
- **Automatic WhatsApp or SMS sending** — share and compose links only, unless
  a legitimate provider is configured and approved.
- **A single "financial health score"** — only transparent, individually
  explained metrics, if any.

---

## 5. Rules that apply to every phase

- **Before coding:** identify the affected models, APIs, UI, migrations,
  compatibility concerns and tests in a short design note, and get approval
  for anything touching the posting model or authorization.
- **Financial features:** tests for the happy path, invalid input, cross-user
  and cross-workspace access, duplicate requests (idempotency keys),
  concurrency, rollback, soft delete and restore, and report totals.
- **No bypassing the engine:** new modules create money movements only via
  `createTransaction` inside `withTransaction`. The frontend never computes an
  authoritative balance.
- **Compatibility:** API changes are additive; no field is renamed without a
  migration and a deprecation window; every migration is idempotent and tested
  on a copy of representative data.
- **Audit:** every new financial or security action writes an `AuditLog` entry
  with no secrets in it.
- **Honesty:** each button works, says clearly that it isn't available yet, or
  sits behind a flag.
- **After each phase:** `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run build` all pass. Failures are fixed, not reported and skipped. Then
  docs are updated.
- **Testing environment:** never against a real database. Use the in-process
  MongoDB (see the README caveat about `server/.env`).

## 6. Documentation plan

| Document | Created in |
|---|---|
| `PRODUCT_AUDIT.md`, `FEATURE_ROADMAP.md` | Phase 0 (this) |
| `FINANCIAL_MODEL.md` (postings, invariants, how new features must post money) | Phase 1 |
| `SECURITY.md` | Phase 1, extended in 9 and 10 |
| `IMPORT_EXPORT.md` | Phase 5 |
| `REPORTING.md` | Phase 7 |
| `OFFLINE_SYNC.md` | Phase 1 (current state), extended in 15 |
| `AI_ARCHITECTURE.md` | Phase 10 |
| `BUSINESS_MODE.md` | Phase 11 |
| `ARCHITECTURE.md` | Updated every phase |
