# Responsive & Device Compatibility — Verification Notes

A frontend-only pass to make the existing app work on phones, tablets, laptops
and large displays, in portrait and landscape. No features were added or
removed, and nothing in the backend, API, database, authentication, or
financial/transaction logic changed. No dependencies were added — everything
is Tailwind v4 utilities, a few rules in `styles/theme.css`, and one viewport
meta attribute.

Checked at 320, 360, 375, 390, 412, 430, 480, 540, 600, 640, 700, 768, 820,
900, 1024, 1100, 1200, 1280, 1366, 1440, 1920 and 2560px wide, plus phone and
tablet landscape, in light and dark themes.

## What shipped

**App shell and navigation**
- `layouts/TopBar.tsx` — the bar's height now includes the status-bar inset
  (`calc(4rem + env(safe-area-inset-top))`), so an installed PWA on a notched
  iPhone keeps a full-height bar instead of squashing its icons. Slightly
  tighter gaps below 360px keep the icon buttons close to their 40px touch
  target (38.8px wide measured at 320px; the full 40px from 360px).
- `layouts/AppShell.tsx`, `layouts/AuthLayout.tsx`, `layouts/MobileNavDrawer.tsx`
  — horizontal safe-area padding, so nothing sits under the notch in
  landscape.
- `layouts/BottomNav.tsx` — labels truncate instead of running into each other
  on the narrowest phones; the bar steps aside while a text field has focus on
  a touch screen (see *On-screen keyboard* below).
- `layouts/MobileNavDrawer.tsx` — **Escape now closes the menu.** A layer on
  top of it takes Escape first: the command palette, or the workspace
  switcher's open dropdown. Sheets already stop Escape themselves.

**Dashboard** (`features/dashboard/DashboardPage.tsx`)
- The widget grid, and every other responsive grid in the app, now declares a
  base `grid-cols-1` — see the first convention below for why.
- The hero balance scales fluidly below `sm` (`clamp(1.75rem, 9vw, 2.5rem)`);
  at 40px a large balance was being clipped by the card's `overflow-hidden`.
  52px from `sm` up, exactly as before.
- Account cards in the phone scroller widen to fit a large balance (capped at
  15rem); between 1024–1279px the strip shows 3 per row instead of 4, because
  the sidebar left ~134px per card.
- "This month" rows wrap the figure under its label only when a narrow column
  can't hold both; Quick actions switch to 2×2 via a container query only
  when their own card is too narrow for four labels.

**Lists** — `TransactionRow`, `AccountsPage`, `PeoplePage`, `RecurringPage`,
`WorkspaceSettings`: at 320–375px, names were being squeezed to zero width by
the amount, badges, and action buttons. The amount (or action group) now drops
to its own line only when the name would otherwise fall below a minimum
width; wider screens are unchanged.

**Forms, filters and settings**
- Transactions and People: the search field takes a full row on phones (it was
  squeezed to ~30px next to the other filters). Transaction summary tiles
  become compact label/amount rows below `sm`.
- Settings: preference and header rows let their control drop below the label
  when there isn't room (labels were overlapping their dropdowns); long names
  and emails wrap; the "Resend confirmation email" button may wrap to two
  lines instead of overflowing its notice.

**Tables** — Cash Book, Account and Person ledgers keep their contained
horizontal scroll. Below 1280px the Particulars/Description cell now takes the
leftover width (at least 10rem) and truncates, so the table stays at its
designed width with the amount columns close by, instead of growing with the
longest description. At 1280px and up the tables are unchanged.

**Overlays**
- `components/ui/Sheet.tsx` — footer bottom padding is now
  `max(1rem, env(safe-area-inset-bottom))`. It was previously **zero on every
  device** (see *Bugs caught* below).
- `features/transactions/QuickAddSheet.tsx` — the sticky Save bar is pinned to
  the sheet's real bottom edge, so fields no longer show through beneath it
  when the form scrolls (short phones, landscape, keyboard open).
- `features/transactions/TransactionDetailSheet.tsx` — the description wraps on
  phones (it's the only place the full text is shown); the amount is fluid
  below `sm`.
- `components/ui/Toast.tsx` — below `lg` toasts sit above the bottom nav
  instead of on top of it.
- `components/CommandPalette.tsx` — `vh` → `dvh`.
- `components/PinLockScreen.tsx` — scrolls when the keypad is taller than the
  screen (phone landscape), with the logo and "Sign in with password instead"
  both reachable.

**Touch** — `features/transactions/AttachmentList.tsx`: the remove button was
hover-only (`opacity-0 group-hover:opacity-100`), so it was invisible on touch
screens. It's now always visible on coarse pointers and on keyboard focus. The
dashboard's small privacy toggle gets a larger tap area via a pseudo-element,
without moving the layout.

**On-screen keyboard**
- `index.html` — `interactive-widget=resizes-content`: where supported (Android
  Chrome) the keyboard shrinks the layout viewport, so bottom sheets and their
  action buttons stay above it.
- `styles/theme.css` — while a text field has focus on a touch screen below
  `lg`, the bottom nav is hidden (`[data-bottom-nav]` rule); otherwise it would
  ride up on top of the keyboard. `scroll-padding` on `<html>` keeps a focused
  field clear of the sticky top bar and the bottom nav.

**Settings toggles** — `NotificationSettings.tsx`, `PreferencesSettings.tsx`:
the switch knob now sits inside the track (see *Bugs caught*).

## Pre-existing bugs the audit caught

1. **A resize or tablet rotation made the dashboard scroll sideways.** The
   widget grid had no base column template (`grid gap-5 lg:grid-cols-3`), so
   below `lg` it used one implicit `auto` column. Recharts' fixed-width chart
   pinned that column at the previous width, so rotating a tablet from
   landscape to portrait left an 800px-wide dashboard in a 768px screen. The
   same missing base template made Budgets and Goals cards ~400px wide on
   phones.
2. **`pb-safe` was zeroing padding.** The custom `.pb-safe` utility is
   declared after Tailwind's generated utilities, so `py-4 pb-safe` resolves
   to a bottom padding of `env(safe-area-inset-bottom)` — **0 on almost every
   device**. Every sheet footer's buttons sat flush with the screen edge on
   phones, and were clipped by the rounded corners of desktop dialogs; toasts
   sat flush against the bottom edge.
3. **The PIN lock screen was unusable in phone landscape.** A fixed,
   vertically centred, non-scrolling ~516px column: the top and bottom were
   cut off with no way to reach them.
4. **Settings switches rendered the knob in the wrong place at every width.**
   The knob is `absolute` with no horizontal inset, and inside a `<button>`
   its static position is centred — so OFF sat on the right and ON overflowed
   the track. Fixed with `left-0`.

## Conventions for new UI

These are the patterns this pass settled on. Following them keeps new screens
working at every width without a separate audit.

- **Always give a responsive grid a base template:**
  `grid grid-cols-1 gap-4 sm:grid-cols-2`. Tailwind's `grid-cols-N` is
  `repeat(N, minmax(0, 1fr))`; without it, the implicit `auto` column grows to
  the widest nowrap content (a truncated name, a figure, a chart).
- **A name next to an amount:** wrap the two in
  `flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-3 gap-y-1`,
  give the name block `min-w-0 flex-1 basis-24`, and put the `<Money>` after
  it. The amount drops below only when the name would get less than 6rem. Use
  a wider basis if the row carries a wide badge (`TransactionRow` uses
  `basis-36` for "Internal transfer"). **Never truncate a `<Money>`** — names
  truncate, figures don't.
- **A title and badges on one line:**
  `flex flex-wrap items-center gap-x-2 gap-y-0.5 sm:flex-nowrap`, with the
  title `min-w-0 max-w-full truncate`.
- **A heading with an action button:** `flex flex-wrap … gap-x-4 gap-y-3`,
  text `min-w-0 flex-1 basis-48`; add `ml-auto` to the action if it should stay
  right-aligned after wrapping.
- **A search field in a filter row:**
  `min-w-0 grow basis-full sm:basis-0 sm:max-w-xs`.
- **Large figures on phones:** use a fluid size,
  `text-[length:clamp(…)]`. When overriding a `<Money>` size through
  `className`, re-state its `leading-*` — tailwind-merge drops an earlier
  `leading-*` when a later font-size class appears. A `max-sm:` override
  doesn't conflict, so it doesn't need this.
- **Wide tables:** keep the `overflow-x-auto` wrapper and a `min-w-[…]` on the
  table. Give the long-text cell
  `max-xl:w-full max-xl:min-w-40 max-xl:max-w-0` and truncate inside it.
- **Safe areas:** `.pb-safe` / `.pt-safe` *replace* padding rather than add to
  it. To keep a base padding use
  `pb-[max(1rem,env(safe-area-inset-bottom,0px))]`. Anything sticky under the
  top bar uses `top-[calc(4rem+env(safe-area-inset-top,0px))]`.
- **Sticky elements inside a `Sheet` body:** sticky offsets are measured
  inside the body's 1.25rem bottom padding; see `QuickAddSheet`'s
  `-bottom-5 -mb-5` bar.
- **Full-screen centred layouts must be able to scroll:** use `mt-auto` on the
  first child and `mb-auto` on the last in a scrolling column, not
  `justify-center` in a fixed container (see `PinLockScreen`).
- **No hover-only controls:** pair `group-hover:opacity-100` with
  `focus-visible:opacity-100 pointer-coarse:opacity-100`.
- **Absolutely positioned children of a `<button>`** need an explicit inset
  (`left-0`, `top-0`): their static position is centred.
- **Viewport heights:** `dvh`, not `vh`.
- **Components whose width depends on their grid column** can adapt with a
  container query (`@container` on the card, `@min-[…]:` on the content), as
  `QuickActions` does.

## Verified by

Automated Playwright runs in Chromium against the dev server, at the widths
above:

1. **Every screen at 22 widths** — 24 personal-workspace views (including every
   Settings section and all six Reports tabs) and 6 business views: 660
   page × width checks for page-level horizontal overflow, elements escaping
   the viewport, inputs squeezed below 90px, collapsed truncated text,
   overlapping bottom-nav labels, and top-bar icon size. Repeated at 5 widths
   in dark mode (150 checks). Run again after the final fixes: everything
   passed except the top-bar icon size at 320px, which measures 38.8px wide
   against a 40px target (40px from 360px up).
2. **Every overlay at 6 sizes** (320×640, 375×667, 412×915, 768×1024, 1440×900,
   667×375 landscape) — Quick Add, transaction detail, account/person/budget/
   goal/recurring/workspace forms, lend/repay/settle, confirm dialog, PIN
   sheet, command palette, account menu, mobile drawer and workspace switcher:
   the panel stays inside the viewport, nothing escapes it, and footer buttons
   are on screen with their padding.
3. **Signed-out screens and onboarding** (login, register, forgot/reset
   password, verify email, all three onboarding steps) at 8 sizes, including
   phone and tablet landscape.
4. **PIN lock screen** at 7 sizes, portrait and landscape.
5. **Switches and Escape** — 46 checks for the notification toggles
   (light/dark × 375/768/1440, click to flip and restore) and the drawer's
   Escape behaviour at 375×812, 768×1024 and 667×375, including the nested
   dropdown and palette cases and the unchanged backdrop, X-button and
   nav-link paths; 10 more for the Preferences toggles.
6. **Desktop regression** — the 1440px dashboard and ledger screenshots were
   compared against the originals; layout and type are unchanged apart from
   the deliberate differences listed below.
7. `npm run typecheck` — clean. `npm run build` — succeeds.
   `npm run test:client` — 44/44.

The test data deliberately used extreme content: ₹10-crore-plus balances,
40-character account names, 80-character descriptions, and long email
addresses.

**Deliberate differences on desktop:** sheet footers and toasts now have the
16px bottom spacing the code always intended (bug 2); dashboard account cards
are 3 per row between 1024–1279px; ledger descriptions truncate below 1280px;
settings switches draw correctly.

## Known follow-ups — still not done

- **Figures of ₹10 crore and above can still overrun their tile by up to a few
  dozen pixels** in these narrow spots (the page itself never scrolls
  sideways): the 3-across stat tiles on Accounts, Cash Book and Reports at
  640–767px, the 4-across Reports › Annual tiles at 1024–1100px, the
  dashboard's 5-across account cards at 1280–1366px, and the account-ledger
  header balance on phones up to 390px. Seen only with the stress-test
  figures above.
- **Tested in Chromium viewport emulation, not on physical devices.** Safe-area
  insets, the on-screen keyboard and real touch input were not exercised on
  iOS or Android hardware.
- **iOS Safari ignores `interactive-widget`.** There the keyboard overlays a
  bottom sheet; the sheet body scrolls to the focused field, but its footer
  can sit behind the keyboard until it's dismissed.
- Tables use contained horizontal scrolling on phones rather than a card
  layout — by design; every amount is still reachable.
- Bottom-nav labels truncate below 360px ("Transact…"), and the top-bar icon
  buttons are 38.8px rather than 40px wide at 320px.
- The mobile drawer closes on Escape but still has no focus trap or focus
  return (pre-existing).
- `npm run lint` fails: the script calls ESLint, but ESLint isn't installed
  and the repository has no ESLint config.
- Three server tests (`tests/auth.test.ts`, `tests/env.test.ts`) fail on a
  machine whose local `server/.env` sets `COOKIE_CROSS_SITE` or `MONGODB_URI`:
  dotenv loads that file into the test process, and those tests assert the
  defaults (a `SameSite=Strict` cookie; refusing to boot in production without
  a URI). They fail identically on the code from before this pass, and no
  server code was changed.
