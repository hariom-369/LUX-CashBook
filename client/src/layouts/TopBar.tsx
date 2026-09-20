import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, Eye, EyeOff, LogOut, Menu, Moon, Search, Settings, Sun, User } from 'lucide-react';
import { cn } from '../lib/cn';
import { useUiStore, resolveTheme } from '../stores/ui.store';
import { useAuthStore } from '../stores/auth.store';
import { navItemsFor } from '../config/navigation';
import { Logo } from '../components/brand/Logo';
import { useNotifications } from '../lib/queries3';

/**
 * The top bar.
 *
 * Two controls here earn their prominence: the command palette (⌘K, §65) and the
 * privacy toggle (§38). Privacy in particular has to be one tap from anywhere —
 * the moment it is useful is the moment someone is standing behind you.
 */
export function TopBar() {
  const location = useLocation();
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const privacyMode = useUiStore((s) => s.privacyMode);
  const togglePrivacy = useUiStore((s) => s.togglePrivacyMode);
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);

  const user = useAuthStore((s) => s.user);
  const mode = useAuthStore(
    (s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.mode ?? 'personal',
  );

  const current = navItemsFor(mode).find((item) =>
    item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to),
  );

  const isDark = resolveTheme(theme) === 'dark';

  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-2 border-b border-line bg-canvas/85 px-4 backdrop-blur-xl sm:px-6 pt-safe">
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        aria-label="Open menu"
        className="-ml-1.5 flex size-10 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-sunken lg:hidden"
      >
        <Menu aria-hidden className="size-5" />
      </button>

      <Logo compact className="lg:hidden" />

      <h1 className="hidden min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em] text-ink lg:block">
        {current?.label ?? 'Khata'}
      </h1>

      <div className="flex-1" />

      {/* Desktop search opens the palette rather than being a second search box. */}
      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        className="hidden h-10 w-64 items-center gap-2.5 rounded-md border border-line bg-sunken px-3 text-[13px] text-ink-faint transition-colors hover:border-line-strong hover:bg-surface md:flex"
      >
        <Search aria-hidden className="size-4" />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="rounded-sm border border-line bg-surface px-1.5 py-0.5 font-sans text-[10px] font-semibold text-ink-faint">
          Ctrl K
        </kbd>
      </button>

      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        aria-label="Search"
        className="flex size-10 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-sunken md:hidden"
      >
        <Search aria-hidden className="size-[18px]" />
      </button>

      <button
        type="button"
        onClick={togglePrivacy}
        aria-pressed={privacyMode}
        aria-label={privacyMode ? 'Show amounts' : 'Hide amounts'}
        title={privacyMode ? 'Show amounts' : 'Hide amounts'}
        className={cn(
          'flex size-10 items-center justify-center rounded-md transition-colors',
          privacyMode ? 'bg-gold-soft text-gold-strong' : 'text-ink-secondary hover:bg-sunken',
        )}
      >
        {privacyMode ? <EyeOff aria-hidden className="size-[18px]" /> : <Eye aria-hidden className="size-[18px]" />}
      </button>

      <button
        type="button"
        onClick={toggleTheme}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className="flex size-10 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-sunken"
      >
        {isDark ? <Sun aria-hidden className="size-[18px]" /> : <Moon aria-hidden className="size-[18px]" />}
      </button>

      <NotificationBell />

      <AccountMenu name={user?.name ?? ''} email={user?.email ?? ''} avatarUrl={user?.avatarUrl} />
    </header>
  );
}

function NotificationBell() {
  const { data } = useNotifications(true);
  const unreadCount = (data?.meta?.unreadCount as number | undefined) ?? 0;

  return (
    <Link
      to="/notifications"
      aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      className="relative flex size-10 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-sunken"
    >
      <Bell aria-hidden className="size-[18px]" />
      {unreadCount > 0 && (
        <span
          aria-hidden
          className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-gold text-[9px] font-bold text-white"
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </Link>
  );
}

function AccountMenu({ name, email, avatarUrl }: { name: string; email: string; avatarUrl?: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const signOut = useAuthStore((s) => s.signOut);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div ref={containerRef} className="relative ml-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex size-9 items-center justify-center overflow-hidden rounded-full border border-line bg-sunken text-[12px] font-semibold text-ink-secondary transition-colors hover:border-gold"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="size-full object-cover" />
        ) : (
          initials || <User aria-hidden className="size-4" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="animate-rise-in absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-lg border border-line bg-raised p-1 shadow-lg"
        >
          <div className="px-3 py-2.5">
            <p className="truncate text-[13px] font-semibold text-ink">{name}</p>
            <p className="truncate text-[11.5px] text-ink-muted">{email}</p>
          </div>

          <div className="my-1 border-t border-line-faint" />

          <Link
            to="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-sm px-3 py-2 text-[13px] text-ink-secondary transition-colors hover:bg-sunken hover:text-ink"
          >
            <Settings aria-hidden className="size-4" />
            Settings
          </Link>

          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left text-[13px] text-negative transition-colors hover:bg-negative-soft"
          >
            <LogOut aria-hidden className="size-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
