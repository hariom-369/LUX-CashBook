import { NavLink } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { cn } from '../lib/cn';
import { Icon } from '../components/ui/Icon';
import { Logo, LogoMark } from '../components/brand/Logo';
import { NAV_GROUPS, navItemsFor } from '../config/navigation';
import { useUiStore } from '../stores/ui.store';
import { useAuthStore } from '../stores/auth.store';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

/**
 * Desktop navigation.
 *
 * The active item is marked by a thin gold rail rather than a filled pill: on a
 * dense financial sidebar a solid highlight block competes with the numbers on the
 * page, while a 2px rule reads as precise.
 */
export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const mode = useAuthStore(
    (s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.mode ?? 'personal',
  );

  const items = navItemsFor(mode);

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface lg:flex',
        'transition-[width] duration-200 ease-[--ease-out-soft]',
        collapsed ? 'w-[76px]' : 'w-[264px]',
      )}
    >
      <div className={cn('flex h-16 shrink-0 items-center', collapsed ? 'justify-center px-2' : 'px-5')}>
        {collapsed ? <LogoMark /> : <Logo />}
      </div>

      <div className={cn('shrink-0 pb-3', collapsed ? 'px-2' : 'px-3')}>
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>

      <nav aria-label="Main" className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map((group) => {
          const groupItems = items.filter((item) => item.group === group.id);
          if (groupItems.length === 0) return null;

          return (
            <div key={group.id} className="mb-1">
              {group.label && !collapsed && (
                <div className="label-eyebrow px-3 pb-1.5 pt-4">{group.label}</div>
              )}
              {group.label && collapsed && <div aria-hidden className="mx-3 my-3 border-t border-line-faint" />}

              <ul className="flex flex-col gap-0.5">
                {groupItems.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      // `end` only on the dashboard, or every route would match "/".
                      end={item.to === '/'}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex items-center rounded-md text-[13.5px] font-medium',
                          'transition-colors duration-150 ease-[--ease-out-soft]',
                          collapsed ? 'h-11 justify-center' : 'h-10 gap-3 px-3',
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
                          {!collapsed && <span className="truncate">{item.label}</span>}
                          {collapsed && <span className="sr-only">{item.label}</span>}
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

      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={cn(
          'flex h-12 shrink-0 items-center gap-2.5 border-t border-line text-[12.5px] font-medium text-ink-faint',
          'transition-colors hover:bg-sunken hover:text-ink-secondary',
          collapsed ? 'justify-center px-2' : 'px-5',
        )}
      >
        <ChevronLeft
          aria-hidden
          className={cn('size-4 transition-transform duration-200', collapsed && 'rotate-180')}
        />
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}
