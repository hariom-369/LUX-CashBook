import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Briefcase, Check, ChevronsUpDown, Plus, User } from 'lucide-react';
import { cn } from '../lib/cn';
import { useAuthStore } from '../stores/auth.store';
import { useT } from '../i18n';

/**
 * Switch between Personal and Business workspaces (§4).
 *
 * Switching swaps the entire dataset, so the React Query cache must be cleared —
 * otherwise the dashboard would briefly render the previous workspace's balances
 * while the new ones load, which on a financial screen is not a cosmetic glitch.
 */
export function WorkspaceSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const t = useT();
  const workspaces = useAuthStore((s) => s.workspaces);
  const activeId = useAuthStore((s) => s.activeWorkspaceId);
  const switchWorkspace = useAuthStore((s) => s.switchWorkspace);
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!active) return null;

  async function select(id: string) {
    setOpen(false);
    if (id === activeId) return;
    await switchWorkspace(id);
    // Drop everything: no query result from the old workspace is valid here.
    queryClient.clear();
  }

  const ModeIcon = active.mode === 'business' ? Briefcase : User;

  return (
    <div ref={containerRef} className="relative">
      {/* A disclosure, not a listbox/menu: the panel mixes buttons and a link, and a disclosure
          needs no arrow-key contract — Tab walks it, Escape closes it and returns here. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        title={collapsed ? active.name : undefined}
        className={cn(
          'flex w-full items-center rounded-md border border-line bg-sunken text-left',
          'transition-colors hover:border-line-strong hover:bg-surface',
          collapsed ? 'h-11 justify-center px-0' : 'h-12 gap-2.5 px-3',
        )}
      >
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-sm',
            active.mode === 'business' ? 'bg-ink text-ink-inverse' : 'bg-gold-soft text-gold-strong',
          )}
        >
          <ModeIcon aria-hidden className="size-3.5" />
        </span>

        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-ink">{active.name}</span>
              <span className="block truncate text-[11px] text-ink-muted">
                {t(`workspaceMode.${active.mode}`)} · {active.currency}
              </span>
            </span>
            <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-ink-faint" />
          </>
        )}
        {collapsed && <span className="sr-only">{t('layout.switchWorkspaceCurrently')} {active.name}</span>}
      </button>

      {open && (
        <div
          id={panelId}
          className="animate-rise-in absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-line bg-raised p-1 shadow-lg"
        >
          <ul aria-label={t('layout.workspaces')}>
          {workspaces.map((workspace) => (
            <li key={workspace.id}>
            <button
              type="button"
              aria-current={workspace.id === activeId ? 'true' : undefined}
              onClick={() => void select(workspace.id)}
              className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left transition-colors hover:bg-sunken"
            >
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-sm',
                  workspace.mode === 'business' ? 'bg-ink text-ink-inverse' : 'bg-gold-soft text-gold-strong',
                )}
              >
                {workspace.mode === 'business' ? (
                  <Briefcase aria-hidden className="size-3" />
                ) : (
                  <User aria-hidden className="size-3" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{workspace.name}</span>
                <span className="block truncate text-[11px] text-ink-muted">
                  {t(`workspaceMode.${workspace.mode}`)} · {workspace.currency}
                  {workspace.isDemo && ` · ${t('common.demo')}`}
                </span>
              </span>
              {workspace.id === activeId && <Check aria-hidden className="size-3.5 shrink-0 text-gold" />}
            </button>
            </li>
          ))}
          </ul>

          <div className="my-1 border-t border-line-faint" />

          <Link
            to="/settings/workspaces"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-sunken hover:text-ink"
          >
            <span className="flex size-6 items-center justify-center rounded-sm border border-dashed border-line-strong">
              <Plus aria-hidden className="size-3" />
            </span>
            {t('common.newWorkspace')}
          </Link>
        </div>
      )}
    </div>
  );
}
