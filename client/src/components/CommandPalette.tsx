import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search } from 'lucide-react';
import {
  RANGE_PRESET_LABELS,
  TRANSACTION_META,
  formatDate,
  formatMoney,
  resolveRange,
  type AccountDto,
  type Paginated,
  type PayeeDto,
  type PersonDto,
  type TransactionDto,
} from '@khata/shared';
import { cn } from '../lib/cn';
import { Icon } from './ui/Icon';
import { Money } from './ui/Money';
import { navItemsFor } from '../config/navigation';
import { useAuthStore } from '../stores/auth.store';
import { useUiStore } from '../stores/ui.store';
import { useDebounced } from '../hooks/useDebounced';
import { api } from '../lib/api';
import { parseSearchQuery, payeeToUrl, searchToUrl, type StructuredSearch } from '../lib/searchQuery';
import { useCurrency } from '../hooks/useCurrency';
import { useT } from '../i18n';

/**
 * Ctrl/⌘ + K (§65, docs/FEATURE_ROADMAP.md Phase 2 — real global search).
 *
 * Static commands (navigation, actions) filter locally and appear instantly.
 * Once the query is at least 2 characters, live transaction and person matches
 * are fetched from the server's existing search (§23) and merged in underneath —
 * both are written against a generic `Command`, so one list and one keyboard
 * handler serves everything.
 */
interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  group: string;
  run: () => void;
  keywords?: string;
  /** A live transaction result shows its amount alongside the label. */
  amountMinor?: number;
}

/** The icon for an account that has none of its own (an icon name, not text). */
const ACCOUNT_ICON = 'Wallet';

export function CommandPalette() {
  const tr = useT();
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const setQuickAddOpen = useUiStore((s) => s.setQuickAddOpen);
  const togglePrivacy = useUiStore((s) => s.togglePrivacyMode);
  const toggleTheme = useUiStore((s) => s.toggleTheme);

  const navigate = useNavigate();
  const currency = useCurrency();
  const mode = useAuthStore(
    (s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.mode ?? 'personal',
  );

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [liveResults, setLiveResults] = useState<Command[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // The account list is small and rarely changes; fetch it once per time the palette is opened.
  const accountsRef = useRef<Promise<AccountDto[]> | null>(null);
  const listboxId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounced(query.trim(), 250);

  const commands = useMemo<Command[]>(() => {
    const navigation: Command[] = navItemsFor(mode).map((item) => ({
      id: `nav:${item.to}`,
      label: item.label,
      hint: item.description,
      icon: item.icon,
      group: tr('app.goTo2'),
      run: () => navigate(item.to),
    }));

    const actions: Command[] = [
      {
        id: 'action:add',
        label: tr('common.addTransaction'),
        hint: 'Income, expense, transfer, lend, borrow or repay',
        icon: 'Plus',
        group: tr('app.actions'),
        keywords: 'new record entry income expense transfer lend borrow repay',
        run: () => setQuickAddOpen(true),
      },
      {
        id: 'action:privacy',
        label: tr('app.togglePrivacyMode'),
        hint: tr('app.hideEveryAmountOnScreen'),
        icon: 'EyeOff',
        group: tr('app.actions'),
        keywords: 'hide mask balance private',
        run: togglePrivacy,
      },
      {
        id: 'action:theme',
        label: tr('app.toggleLightDark'),
        icon: 'Moon',
        group: tr('app.actions'),
        keywords: 'theme dark light appearance',
        run: toggleTheme,
      },
    ];

    return [...actions, ...navigation];
  }, [mode, navigate, setQuickAddOpen, togglePrivacy, toggleTheme, tr]);

  const staticResults = useMemo(() => {
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

  const results = useMemo(
    () => (debouncedQuery.length >= 2 ? [...staticResults, ...liveResults] : staticResults),
    [staticResults, liveResults, debouncedQuery],
  );

  // Live data search (§23): transactions and people matching the query, from the
  // same endpoints their own list pages already use — nothing palette-specific to
  // keep correct. Cancelled if the query changes again before it resolves, so a
  // fast typist never sees a stale search's results flash in after a newer one.
  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setLiveResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);

    accountsRef.current ??= api.get<AccountDto[]>('/accounts').then((r) => (Array.isArray(r) ? r : [])).catch(() => []);

    accountsRef.current.then((accounts) => {
      if (cancelled) return;
      // "above ₹5000", "Zomato last 3 months", "UPI expenses" become the list's own filters; anything
      // that is not clearly one stays a plain text search, exactly as before.
      const reading = parseSearchQuery(debouncedQuery, accounts);
      const text = reading.text;
      const range = reading.range && reading.range !== 'all_time' ? resolveRange(reading.range) : undefined;

      const transactionQuery: Record<string, string | number | boolean | string[] | undefined> = reading.structured
        ? {
            ...(text ? { search: text } : {}),
            limit: 5,
            ...(range ? { from: range.from.toISOString(), to: range.to.toISOString() } : {}),
            ...(reading.types ? { types: reading.types } : {}),
            ...(reading.accountId ? { accountIds: [reading.accountId] } : {}),
            ...(reading.minAmountMinor !== undefined ? { minAmountMinor: reading.minAmountMinor } : {}),
            ...(reading.maxAmountMinor !== undefined ? { maxAmountMinor: reading.maxAmountMinor } : {}),
          }
        : { search: debouncedQuery, limit: 5 };
      // People, payees and accounts are looked up by the words that are left; a query that was all filters has none.
      const needle = reading.structured ? text : debouncedQuery;

      Promise.all([
        api
          // The list endpoint pages its payload: `data` is `{ items, total, … }`, not a bare array.
          .getWithMeta<Paginated<TransactionDto>>('/transactions', { query: transactionQuery })
          .then((r) => r.data.items)
          .catch(() => []),
        needle.length >= 2
          ? api.get<PersonDto[]>('/people', { query: { search: needle } }).then((r) => r.slice(0, 5)).catch(() => [])
          : Promise.resolve([] as PersonDto[]),
        needle.length >= 2
          ? api.get<PayeeDto[]>('/payees', { query: { search: needle } }).then((r) => r.slice(0, 5)).catch(() => [])
          : Promise.resolve([] as PayeeDto[]),
      ]).then(([transactions, people, payees]) => {
        if (cancelled) return;
        const lowered = needle.toLowerCase();
        const accountCommands: Command[] =
          needle.length >= 2
            ? accounts
                .filter((a) => a.name.toLowerCase().includes(lowered))
                .slice(0, 5)
                .map((a) => ({
                  id: `account:${a.id}`,
                  label: a.name,
                  hint: tr.label('accountType', a.type, a.type),
                  icon: a.icon || ACCOUNT_ICON,
                  group: tr('nav.accounts'),
                  run: () => navigate(`/accounts/${a.id}`),
                }))
            : [];
        const payeeCommands: Command[] = payees.map((p) => ({
          id: `payee:${p.id}`,
          label: p.name,
          hint: tr('palette.payeeHint'),
          icon: 'Store',
          group: tr('settings.tab.payees'),
          run: () => navigate(payeeToUrl(p.id, p.name)),
        }));
        const transactionCommands: Command[] = transactions.map((t) => {
          const meta = TRANSACTION_META[t.type];
          return {
            id: `txn:${t.id}`,
            label: t.description || t.categoryName || t.personName || tr.label('txType', t.type, meta.label),
            hint: `${formatDate(t.date)} · ${tr.label('txType', t.type, meta.label)}`,
            icon: t.categoryIcon ?? meta.icon,
            group: tr('nav.transactions'),
            run: () => navigate(`/transactions?q=${encodeURIComponent(t.description || t.referenceNo || '')}`),
            amountMinor: t.amountMinor,
          };
        });
        const personCommands: Command[] = people.map((p) => ({
          id: `person:${p.id}`,
          label: p.name,
          hint: p.balanceMinor > 0 ? tr('app.owesYou') : p.balanceMinor < 0 ? tr('app.youOwe') : tr('common.settled'),
          icon: 'User',
          group: tr('nav.people'),
          run: () => navigate(`/people/${p.id}`),
        }));
        // Lead with the reading itself, so it is always visible exactly what was understood.
        const readingCommand: Command[] = reading.structured
          ? [
              {
                id: 'search:structured',
                label: tr('palette.showMatching'),
                hint: describeReading(reading, accounts, tr, currency),
                icon: 'ListFilter',
                group: tr('palette.search'),
                run: () => navigate(searchToUrl(reading)),
              },
            ]
          : [];
        setLiveResults([...readingCommand, ...transactionCommands, ...accountCommands, ...payeeCommands, ...personCommands]);
        setSearching(false);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, navigate, tr, currency]);

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
      accountsRef.current = null;
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

  // Consecutive results sharing a group render under one labelled group, keeping the
  // flat `results` index so keyboard navigation and `aria-activedescendant` stay simple.
  const groups: Array<{ name: string; items: Array<{ command: Command; index: number }> }> = [];
  results.forEach((command, index) => {
    const last = groups[groups.length - 1];
    if (last && last.name === command.group) last.items.push({ command, index });
    else groups.push({ name: command.group, items: [{ command, index }] });
  });
  const optionId = (index: number) => `${listboxId}-opt-${index}`;
  const activeId = results.length > 0 && results[cursor] ? optionId(cursor) : undefined;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[12dvh]">
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className="animate-fade-in absolute inset-0 bg-overlay backdrop-blur-[2px]"
      />

      {/* The dialog owns arrow/enter/escape navigation for the whole palette; the handler is the widget's keyboard contract, not a stray listener. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('app.commandPalette')}
        onKeyDown={onKeyDown}
        className="animate-rise-in relative flex max-h-[62dvh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-raised shadow-lg"
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
            placeholder={tr('common.searchOrJumpTo')}
            aria-label={tr('app.searchCommands')}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            className="h-full flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <kbd className="rounded-sm border border-line bg-sunken px-1.5 py-0.5 text-[10px] font-semibold text-ink-faint">
            Esc
          </kbd>
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          {searching ? tr('app.searching') : query ? tr.plural('app.resultsCount', results.length) : ''}
        </div>

        <div ref={listRef} id={listboxId} role="listbox" aria-label={tr('app.commandPalette')} className="min-h-0 flex-1 overflow-y-auto p-2">
          {results.length === 0 && (
            <p className="px-3 py-10 text-center text-[13px] text-ink-muted">
              {searching ? tr('app.searching') : tr('app.nothingMatches', { query })}
            </p>
          )}

          {groups.map((group) => (
            // The same group name can recur non-consecutively (static commands, then live results), so the first option's index disambiguates.
            <div key={`${group.name}:${group.items[0]!.index}`} role="group" aria-label={group.name}>
              <div aria-hidden className="label-eyebrow px-3 pb-1 pt-3">
                {group.name}
              </div>
              {group.items.map(({ command, index }) => {
                const active = index === cursor;
                return (
                  <button
                    key={command.id}
                    id={optionId(index)}
                    type="button"
                    role="option"
                    tabIndex={-1}
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
                    {command.amountMinor !== undefined && (
                      <Money amountMinor={command.amountMinor} size="sm" tone="neutral" compactDecimals />
                    )}
                    {active && <CornerDownLeft aria-hidden className="size-3.5 shrink-0 text-ink-faint" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** "Expenses · GPay · above ₹5,000 · Last 3 months · “Zomato”" — what the palette understood, in the person's own words. */
function describeReading(
  reading: StructuredSearch,
  accounts: AccountDto[],
  tr: ReturnType<typeof useT>,
  currency: string,
): string {
  const parts: string[] = [];
  if (reading.types) parts.push(reading.types.map((type) => tr.label('txType', type, TRANSACTION_META[type].label)).join(' / '));
  const account = accounts.find((a) => a.id === reading.accountId);
  if (account) parts.push(account.name);
  if (reading.minAmountMinor !== undefined) parts.push(tr('palette.above', { amount: formatMoney(reading.minAmountMinor, { currency, compactDecimals: true }) }));
  if (reading.maxAmountMinor !== undefined) parts.push(tr('palette.below', { amount: formatMoney(reading.maxAmountMinor, { currency, compactDecimals: true }) }));
  if (reading.range) parts.push(tr.label('range', reading.range, RANGE_PRESET_LABELS[reading.range]));
  if (reading.text) parts.push(`“${reading.text}”`);
  return parts.join(' · ');
}
