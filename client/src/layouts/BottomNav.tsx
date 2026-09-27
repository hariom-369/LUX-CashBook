import { NavLink } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { cn } from '../lib/cn';
import { Icon } from '../components/ui/Icon';
import { mobileNavItems } from '../config/navigation';
import { useAuthStore } from '../stores/auth.store';
import { useUiStore } from '../stores/ui.store';

/**
 * Mobile navigation (§3, §63).
 *
 * Four destinations plus a raised central add button. Adding a transaction is the
 * action people perform many times a day and everything else a handful of times, so
 * it gets the single most reachable position on the screen — the middle of the
 * thumb arc — rather than a corner.
 */
export function BottomNav() {
  const mode = useAuthStore(
    (s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.mode ?? 'personal',
  );
  const setQuickAddOpen = useUiStore((s) => s.setQuickAddOpen);

  const items = mobileNavItems(mode);
  const left = items.slice(0, 2);
  const right = items.slice(2, 4);

  return (
    <nav
      aria-label="Primary"
      // Hook for the stylesheet rule that steps this bar aside while the on-screen keyboard is up.
      data-bottom-nav=""
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas/90 backdrop-blur-xl pb-safe lg:hidden"
    >
      <div className="relative mx-auto flex h-16 max-w-lg items-stretch">
        {left.map((item) => (
          <BottomNavLink key={item.to} to={item.to} icon={item.icon} label={item.label} />
        ))}

        <div className="flex w-[72px] shrink-0 items-start justify-center min-[360px]:w-[84px]">
          <button
            type="button"
            onClick={() => setQuickAddOpen(true)}
            aria-label="Add transaction"
            className={cn(
              'absolute -top-5 flex size-14 items-center justify-center rounded-full',
              'bg-gold text-white shadow-gold ring-4 ring-canvas',
              'transition-transform duration-150 ease-[--ease-out-soft] active:scale-95',
            )}
          >
            <Plus aria-hidden className="size-6" strokeWidth={2.25} />
          </button>
        </div>

        {right.map((item) => (
          <BottomNavLink key={item.to} to={item.to} icon={item.icon} label={item.label} />
        ))}
      </div>
    </nav>
  );
}

function BottomNavLink({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          // `min-w-0` lets the label truncate instead of pushing into its neighbour on narrow phones.
          'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 pt-1 text-[10.5px] font-medium',
          'transition-colors duration-150',
          isActive ? 'text-ink' : 'text-ink-faint',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            name={icon}
            aria-hidden
            className={cn('size-[21px]', isActive && 'text-gold')}
            strokeWidth={isActive ? 2.1 : 1.8}
          />
          <span className="max-w-full truncate">{label}</span>
        </>
      )}
    </NavLink>
  );
}
