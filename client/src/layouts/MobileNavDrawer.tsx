import { NavLink } from 'react-router-dom';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';
import { Icon } from '../components/ui/Icon';
import { Logo } from '../components/brand/Logo';
import { NAV_GROUPS, navItemsFor } from '../config/navigation';
import { useAuthStore } from '../stores/auth.store';
import { useUiStore } from '../stores/ui.store';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

/**
 * The full navigation on a phone.
 *
 * The bottom bar carries the four most-used destinations; everything else lives
 * here, so a small screen still reaches every feature (§3) rather than getting a
 * cut-down version of the app.
 */
export function MobileNavDrawer() {
  const open = useUiStore((s) => s.mobileNavOpen);
  const setOpen = useUiStore((s) => s.setMobileNavOpen);
  const mode = useAuthStore(
    (s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.mode ?? 'personal',
  );

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
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="animate-fade-in relative flex h-full w-[86%] max-w-xs flex-col border-r border-line bg-surface pt-safe"
      >
        <div className="flex h-16 shrink-0 items-center justify-between px-5">
          <Logo />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
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
                {group.label && <div className="label-eyebrow px-3 pb-1.5 pt-4">{group.label}</div>}
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
                            {item.label}
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
