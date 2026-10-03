import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';
import { Icon } from '../components/ui/Icon';
import { Logo } from '../components/brand/Logo';
import { NAV_GROUPS, navItemsFor } from '../config/navigation';
import { useAuthStore } from '../stores/auth.store';
import { useUiStore } from '../stores/ui.store';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { useNavLabels } from '../i18n/nav';
import { useT } from '../i18n';

/**
 * The full navigation on a phone.
 *
 * The bottom bar carries the four most-used destinations; everything else lives
 * here, so a small screen still reaches every feature (§3) rather than getting a
 * cut-down version of the app.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function MobileNavDrawer() {
  const t = useT();
  const navLabels = useNavLabels();
  const open = useUiStore((s) => s.mobileNavOpen);
  const setOpen = useUiStore((s) => s.setMobileNavOpen);
  const mode = useAuthStore(
    (s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.mode ?? 'personal',
  );
  const panelRef = useRef<HTMLDivElement>(null);

  // Keyboard behaviour, matching every Sheet: focus moves into the drawer, Tab
  // stays inside it while it's open, and focus returns to whatever opened it (the
  // menu button) when it closes. Escape closes it — but a layer above gets that
  // Escape first: the command palette (another dialog) or the workspace
  // switcher's open dropdown. Sheets already stop Escape in their capture phase.
  useEffect(() => {
    if (!open) return;

    const restoreFocusTo = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }, 0);

    function onKeyDown(event: KeyboardEvent) {
      const panel = panelRef.current;
      if (!panel) return;
      const dialog = (event.target as Element | null)?.closest?.('[role="dialog"]');
      if (dialog && dialog !== panel) return;

      if (event.key === 'Tab') {
        const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          (el) => el.offsetParent !== null,
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (!panel.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      if (event.key !== 'Escape') return;
      if (panel.querySelector('[aria-expanded="true"]')) return;
      setOpen(false);
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      restoreFocusTo?.focus?.();
    };
  }, [open, setOpen]);

  if (!open) return null;
  const items = navItemsFor(mode);

  return (
    <div className="fixed inset-0 z-[55] lg:hidden">
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className="animate-fade-in absolute inset-0 bg-overlay backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('layout.navigation')}
        className="animate-fade-in relative flex h-full w-[86%] max-w-xs flex-col border-r border-line bg-surface pl-[env(safe-area-inset-left,0px)] pt-safe"
      >
        <div className="flex h-16 shrink-0 items-center justify-between px-5">
          <Logo />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t('layout.closeMenu')}
            className="-mr-2 flex size-10 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-sunken"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <div className="shrink-0 px-3 pb-3">
          <WorkspaceSwitcher />
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-8">
          {NAV_GROUPS.map((group) => {
            const groupItems = items.filter((item) => item.group === group.id);
            if (groupItems.length === 0) return null;

            return (
              <div key={group.id}>
                {group.label && <div className="label-eyebrow px-3 pb-1.5 pt-4">{navLabels.group(group.id, group.label)}</div>}
                <ul className="flex flex-col gap-0.5">
                  {groupItems.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === '/'}
                        onClick={() => setOpen(false)}
                        className={({ isActive }) =>
                          cn(
                            'flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                            isActive
                              ? 'nav-active-rail bg-sunken text-ink'
                              : 'text-ink-muted hover:bg-sunken/60 hover:text-ink-secondary',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <Icon
                              name={item.icon}
                              aria-hidden
                              className={cn('size-[18px] shrink-0', isActive && 'text-gold')}
                              strokeWidth={isActive ? 2.1 : 1.8}
                            />
                            {navLabels.item(item)}
                          </>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
