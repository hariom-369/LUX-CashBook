import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search } from 'lucide-react';
import { cn } from '../lib/cn';
import { Icon } from './ui/Icon';
import { navItemsFor } from '../config/navigation';
import { useAuthStore } from '../stores/auth.store';
import { useUiStore } from '../stores/ui.store';

/**
 * Ctrl/⌘ + K (§65).
 *
 * Phase 1 navigates and triggers app actions. Phase 2 adds live transaction and
 * person results to the same list, which is why matching and rendering are written
 * against a generic `Command` rather than against the nav config directly.
 */
interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  group: string;
  run: () => void;
  keywords?: string;
}

export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const setQuickAddOpen = useUiStore((s) => s.setQuickAddOpen);
  const togglePrivacy = useUiStore((s) => s.togglePrivacyMode);
  const toggleTheme = useUiStore((s) => s.toggleTheme);

  const navigate = useNavigate();
  const mode = useAuthStore(
    (s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.mode ?? 'personal',
  );

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const navigation: Command[] = navItemsFor(mode).map((item) => ({
      id: `nav:${item.to}`,
      label: item.label,
      hint: item.description,
      icon: item.icon,
      group: 'Go to',
      run: () => navigate(item.to),
    }));

    const actions: Command[] = [
      {
        id: 'action:add',
        label: 'Add transaction',
        hint: 'Income, expense, transfer, lend, borrow or repay',
        icon: 'Plus',
        group: 'Actions',
        keywords: 'new record entry income expense transfer lend borrow repay',
        run: () => setQuickAddOpen(true),
      },
      {
        id: 'action:privacy',
        label: 'Toggle privacy mode',
        hint: 'Hide every amount on screen',
        icon: 'EyeOff',
        group: 'Actions',
        keywords: 'hide mask balance private',
        run: togglePrivacy,
      },
      {
        id: 'action:theme',
        label: 'Toggle light / dark',
        icon: 'Moon',
        group: 'Actions',
        keywords: 'theme dark light appearance',
        run: toggleTheme,
      },
    ];

    return [...actions, ...navigation];
  }, [mode, navigate, setQuickAddOpen, togglePrivacy, toggleTheme]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands
      .map((command) => {
        const haystack = `${command.label} ${command.hint ?? ''} ${command.keywords ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return null;
        // Prefix matches on the label rank above an incidental mention in a hint.
        const score = command.label.toLowerCase().startsWith(q) ? 0 : haystack.indexOf(q) + 1;
        return { command, score };
      })
      .filter((x): x is { command: Command; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.command);
  }, [commands, query]);

  // Global shortcut. Registered once, whether or not the palette is open.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(!useUiStore.getState().commandPaletteOpen);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      // The palette mounts and focuses in the same frame; a timeout avoids the
      // focus landing before the element is in the document.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  function choose(command: Command | undefined) {
    if (!command) return;
    setOpen(false);
    command.run();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => (c + 1) % Math.max(results.length, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => (c - 1 + results.length) % Math.max(results.length, 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[cursor]);
    }
  }

  let lastGroup = '';

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[12vh]">
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className="animate-fade-in absolute inset-0 bg-overlay backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        className="animate-rise-in relative flex max-h-[62vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-raised shadow-lg"
      >
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
          <Search aria-hidden className="size-4 shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            placeholder="Search or jump to…"
            aria-label="Search commands"
            className="h-full flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <kbd className="rounded-sm border border-line bg-sunken px-1.5 py-0.5 text-[10px] font-semibold text-ink-faint">
            Esc
          </kbd>
        </div>

        <div ref={listRef} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
          {results.length === 0 && (
            <p className="px-3 py-10 text-center text-[13px] text-ink-muted">
              Nothing matches “{query}”.
            </p>
          )}

          {results.map((command, index) => {
            const showGroup = command.group !== lastGroup;
            lastGroup = command.group;
            const active = index === cursor;

            return (
              <div key={command.id}>
                {showGroup && <div className="label-eyebrow px-3 pb-1 pt-3">{command.group}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-active={active}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => choose(command)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
                    active ? 'bg-sunken' : 'hover:bg-sunken/60',
                  )}
                >
                  <Icon
                    name={command.icon}
                    aria-hidden
                    className={cn('size-4 shrink-0', active ? 'text-gold' : 'text-ink-faint')}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ink">{command.label}</span>
                    {command.hint && (
                      <span className="block truncate text-[11.5px] text-ink-muted">{command.hint}</span>
                    )}
                  </span>
                  {active && <CornerDownLeft aria-hidden className="size-3.5 shrink-0 text-ink-faint" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
