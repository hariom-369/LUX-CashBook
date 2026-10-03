# Phase 9 — Household Workspaces — Verification Notes

Scope: [`FEATURE_ROADMAP.md`](FEATURE_ROADMAP.md#phase-9--household-workspaces-p2-decision-4),
decision 4. Closes [`PRODUCT_AUDIT.md`](PRODUCT_AUDIT.md) finding D-2. The
roadmap itself names this **the highest-risk phase** and calls for a
dedicated authorization test suite and review before release — both are
addressed below, with the review's status stated plainly rather than
overclaimed.

## What shipped

**Membership replaces ownership as the access boundary.** `WorkspaceMember`
(workspace, user, role, per-membership `isDefault`) is now what
`middleware/auth.ts#requireWorkspace` actually checks — not
`Workspace.userId`, which stays only as "the original owner" for display.
This is the one change every other workspace-scoped route depends on, so it
was made in exactly one place (`resolveMembership`, shared between
`requireWorkspace` and `workspace.service.ts`) and verified by re-running the
*entire* existing 235-test server suite against it unchanged — every single
test still passed, confirming the rewrite preserved single-owner behaviour
exactly while adding membership-checking underneath it.

**Roles**: owner, admin, member, viewer. A `viewer` is refused on anything
but a read — enforced as a single check inside `requireWorkspace`, so it
applies to every workspace-scoped route without needing to be added to each
one individually. Only owner/admin can manage members or invitations; only
the owner can promote someone to admin or remove an admin; the owner's own
role can never be changed and the owner can never be removed (they delete
the workspace or, in a future phase, transfer ownership — not built here,
see "Deferred").

**What the audit's "31 `userId`-filtered queries" actually turned out to
be**: not financial data. Every one of them was workspace *listing* or
session resolution (`Workspace.find({userId})` in login, `GET /workspaces`,
workspace-switching) — account-level concepts like `Notification` and the
user's own `AuditLog` entries were already correctly scoped to `userId`
regardless of workspace sharing, and stayed that way. The actual fix was
narrower than the audit feared: those handful of workspace-listing call
sites now resolve membership instead of ownership (`auth.service.ts`,
`user.service.ts`, `workspace.service.ts`), and a genuinely new bug this
surfaced — **backup restore created a workspace without an owner
membership row**, which would have locked the very person restoring their
own backup out of it — was caught and fixed in the same pass.

**Per-member default workspace.** `Workspace.isDefault` (a single flag on
the shared document) does not generalize to a workspace with multiple
members — one member marking a shared workspace "default" would have
silently changed every other member's landing page too. `isDefault` moved
onto `WorkspaceMember` instead, so it is now genuinely per-person.

**Invitations.** Token-based (SHA-256 hash stored, raw token only ever in
the emailed link — the same pattern as email verification and password
reset), scoped to accounts that already exist: the invited email must
already have a Khata account, which is a deliberate boundary (see
"Deferred") rather than also building a parallel invite-to-signup flow.
Accepting requires the signed-in caller's own email to exactly match the
invitation's — a mismatch gets the same 404 as a nonexistent invitation, so
a token can't be used to probe who else uses the app.

**Private accounts.** `Account.visibility` (`shared` default, `private`)
hides an account — and, where enforced, its transactions — from every
member except its creator. Enforced at: account listing
(`accountVisibilityFilter`), direct account access (`getAccount`, which
gates the ledger, reconcile, card-summary, patch and delete routes all at
once since they all call it), and the main transaction list and CSV export
(`buildFilter`'s new `hiddenAccountIds` parameter). See "Known, named gap"
below for what this does *not* yet cover.

**Account deletion no longer destroys a shared workspace.** Before this
phase, deleting your own user account purged every workspace you had any
relationship to. Now it purges only workspaces you *own*; a shared
workspace you're a member of keeps existing for everyone else, with just
your own membership row removed.

## A deliberate, named scope boundary

Invitations require the invited email to already have a Khata account.
Building a parallel "invite someone who doesn't have an account yet, they
sign up through the invite link" flow is a legitimate separate feature,
not attempted here — it would need its own token-carries-context-through-
registration design, which is a different shape of problem than everything
else in this pass.

Ownership transfer was also not built: a workspace keeps the owner it was
created with. Deleting a workspace or removing yourself as a member are
the only ways to change who's in control, for now.

## A known, named gap in private-account enforcement

Private-account filtering was applied at the account-listing and
transaction-list/export choke points, which cover browsing and exporting
transactions directly. It was **not** sweep across every aggregate view —
dashboard totals, the net worth / cash-flow-forecast reports, cash book,
budget spend-by-category, and the per-person/per-loan ledgers each build
their own `Transaction` queries directly rather than going through the one
shared `buildFilter`, and none of those ~10 call sites were individually
audited in this pass. A private account's *contribution to a sum* could
still show up in another member's dashboard total even though the account
itself, its name, and its transaction list stay hidden. This is called out
explicitly, by name, rather than left for someone to discover: **private
accounts should not yet be relied on for strict financial secrecy from
other household members** — they hide browsing and export today, not
necessarily every aggregate figure. Closing this gap (auditing and fixing
the remaining direct `Transaction` queries) is the clearest, most
actionable next step for this feature.

## Verification

1. `npm run typecheck` — clean (shared, server, client).
2. `npm run lint` — clean, repository-wide.
3. `npm test` — **337/337 passing** (server 259: the 17-test dedicated
   authorization suite grew to 19 with two regression tests added after the
   security review below, plus a new assertion on the existing
   private-account test; a 3-test migration suite; client 78, unchanged).
4. `npm run build` — succeeds.
5. All server tests ran against the in-process MongoDB replica set only.
6. **An independent, automated security review of this phase's diff was
   run** (the `security-review` skill, scoped to every file this phase
   touched) specifically because the roadmap itself calls this the
   highest-risk phase and asks for review before release. It returned 4
   high-confidence findings, all fixed before this phase was marked done:
   - Private accounts were enforced on reads (listing, direct access, the
     transaction list/export) but **not on writes** — any member could still
     `POST /transactions`, bank-import, or add a group expense against
     another member's private account by id. Fixed by adding the same
     visibility check to `resolveAccount` (`transaction.service.ts`),
     `previewBankImport` (`bankimport.service.ts`), and `addGroupExpense`
     (`group.service.ts`).
   - `GET /transactions/:id` didn't apply the hidden-account exclusion the
     list and CSV export already had, so a known or guessed transaction id
     could leak a private account's transaction detail directly. Fixed in
     `getTransaction` (`transaction.query.ts`).
   - An admin could invite a new member directly with `role: 'admin'`,
     bypassing the existing (and deliberate) rule that only the owner may
     mint a new admin. `member.service.ts#changeMemberRole` already enforced
     this for promotions; `invitation.service.ts#createInvitation` was
     missing the equivalent guard. Fixed by adding it there too.
   - `POST /push/subscribe` accepted any URL as the push `endpoint`, and the
     server later POSTs to it verbatim (`lib/push.ts`) — an SSRF vector
     (e.g. a cloud metadata address) requiring only `requireAuth`, not any
     workspace privilege. Fixed with a host allowlist restricted to the
     known browser push services (FCM, Mozilla autopush, Windows Notification
     Service), `push.routes.ts`.
   
   Each fix has a dedicated regression test (`householdWorkspaces.test.ts`,
   `billsAndDetector.test.ts`). The review also named one lower-confidence,
   not-yet-fixed gap: the document-vault listing (`GET /attachments`) does
   not filter attachments linked to a private-account transaction — tracked
   below as a follow-up rather than fixed inline, since it's in the same
   family as the already-documented aggregate-view gap and deserves its own
   pass rather than a rushed one bolted onto this review cycle. This review
   is a meaningful one, not a substitute for a human security engineer's
   sign-off before onboarding real households onto this feature.

## Known follow-ups — next phase

- The private-account aggregate-view gap named above is the single most
  concrete, actionable item carried forward.
- The document vault (`GET /attachments`) does not yet filter out
  attachments linked to a private-account transaction — named by the
  security review, not yet fixed; same family as the aggregate-view gap.
- No client-side test for `MembersSheet`, `InvitationPrompt`, or the
  private-account toggle, same reasoning as every phase since Phase 3:
  this codebase's test convention covers components and `lib/` modules,
  not full feature sheets wired to React Query. The authorization logic
  they exercise is fully covered server-side.
- Ownership transfer and invite-to-signup (inviting someone with no
  existing account) remain legitimate, separate features — not started.
- Phase 10 (AI) is next per the roadmap.

## Update — the aggregate gap is closed

The "known, named gap" above is closed. Every query that builds its own
`Transaction`, `Account` or attachment filter now applies the viewer's hidden
accounts — about 65 call sites, found by searching for every `Transaction.` /
`Account.` / `Attachment.` read and write rather than by recalling them:
balances, dashboard, cash book, reports, budgets, goals, recurring, forecast,
detector, loans, reminders, groups, closings, projects, attachments, backups,
import/export, bank import, petty cash, people, audit log and the scheduler.

Design decisions (all tested in `privateAccountLeaks.test.ts`, 18 tests, each
probing a different code path with distinctive figures and failing on any
leaked name, id or number):
- A transaction is visible if at least one posting leg is on a visible
  account. A **transfer touching a hidden account is shown masked** ("Transfer
  with a private account", only the visible leg), so a visible account's
  running balance still adds up — hiding it would make the ledger look wrong,
  which is worse than telling a member that *something* private moved.
- A person's balance is computed per viewer (`getHiddenPersonDeltas`) so a
  loan paid from a private account does not change a member's view of it.
- Write paths treat hidden and masked entries as 404.
- A pitfall found and fixed: spreading `excludeHiddenAccounts()` into a filter
  overwrote an `_id` lookup (a member could create a goal on a hidden account);
  id lookups now use `visibleAccountIds`.

Browser-verified: a member sees no private account, no private entry, no
private balance on Accounts, Cash Book, Transactions or the dashboard, and the
masked transfer keeps the Cash Book arithmetic exact.

**Honest limits.** A member can still infer that *a* private account exists
from the masked transfer line. Private accounts are a visibility feature within
a household that trusts its server operator — they are not encryption; the
database holds the data in the clear (there is no end-to-end encryption in this
application).
