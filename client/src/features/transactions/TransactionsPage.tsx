import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Filter, HandCoins, Paperclip, Plus, Search, Tag, Trash2, X } from 'lucide-react';
import {
  RANGE_PRESET_LABELS,
  TRANSACTION_META,
  TRANSACTION_TYPES,
  formatDate,   resolveRange,
  toDateKey,
  type RangePreset,
  type TransactionDto,
  type TransactionType,
} from '@khata/shared';
import { cn } from '../../lib/cn';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { useT } from '../../i18n';
import { useRelativeDay } from '../../i18n/relativeDay';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useAccounts, useCategories, useInvalidateLedger, useTransactions } from '../../lib/queries';
import { ConfirmDialog } from '../../components/ui/Sheet';
import { useToast } from '../../components/ui/Toast';
import { submitOrQueue } from '../../lib/offlineMutation';
import { useAuthStore } from '../../stores/auth.store';
import { useUiStore } from '../../stores/ui.store';
import { useDebounced } from '../../hooks/useDebounced';
import { LIST_RANGES, readSearchLink } from '../../lib/searchQuery';
import { TransactionRow } from './TransactionRow';
import { TransactionDetailSheet } from './TransactionDetailSheet';

const RANGE_OPTIONS = LIST_RANGES;

/**
 * The transaction list (§23, §24).
 *
 * Filters are a single row above the list, applied together, and the summary
 * updates with them — so "how much did I spend on fuel in August" is answered by
 * the header rather than by the user adding numbers up themselves.
 */
/** Which reimbursement stages each filter choice shows. */
const CLAIM_STAGES = {
  all: ['pending', 'submitted', 'approved', 'paid'],
  owed: ['pending', 'submitted', 'approved'],
  paid: ['paid'],
} as const;

export function TransactionsPage() {
  const tr = useT();
  const setQuickAddOpen = useUiStore((s) => s.setQuickAddOpen);

  // Deep-linked from the command palette's search results (`?q=`) — read once on
  // arrival; the search box's own state owns it from then on, same as every other
  // filter here (none of them stay synced to the URL).
  const [searchParams] = useSearchParams();
  const link = useMemo(() => readSearchLink(searchParams), [searchParams]);
  const [search, setSearch] = useState(() => link.q);
  const [range, setRange] = useState<RangePreset>(() => link.range ?? 'this_month');
  const [types, setTypes] = useState<TransactionType[]>(() => link.types ?? []);
  const [accountId, setAccountId] = useState(() => link.accountId ?? '');
  const [payee, setPayee] = useState(() => link.payee ?? null);
  const [categoryId, setCategoryId] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  // Filters the API always supported but the screen never offered (audit P-2).
  const [tag, setTag] = useState('');
  const [minAmountMinor, setMinAmountMinor] = useState<number | null>(() => link.minAmountMinor ?? null);
  const [maxAmountMinor, setMaxAmountMinor] = useState<number | null>(() => link.maxAmountMinor ?? null);
  const [withReceipts, setWithReceipts] = useState(false);
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  const [claims, setClaims] = useState<'' | 'owed' | 'paid' | 'all'>('');
  const t = useT();
  const relativeDay = useRelativeDay();
  const [showFilters, setShowFilters] = useState(() => link.hasFilters);

  // The palette can send a new search while this screen is already open; apply it, but not on
  // first render (the initial state already did) and not to a link that set nothing.
  const firstLink = useRef(true);
  useEffect(() => {
    if (firstLink.current) {
      firstLink.current = false;
      return;
    }
    setSearch(link.q);
    setRange(link.range ?? 'this_month');
    setTypes(link.types ?? []);
    setAccountId(link.accountId ?? '');
    setPayee(link.payee ?? null);
    setMinAmountMinor(link.minAmountMinor ?? null);
    setMaxAmountMinor(link.maxAmountMinor ?? null);
    if (link.hasFilters) setShowFilters(true);
    setPage(1);
  }, [link]);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<TransactionDto | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const toast = useToast();
  const invalidateLedger = useInvalidateLedger();
  const activeWorkspaceId = useAuthStore((s) => s.activeWorkspaceId);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  function toggleChecked(transaction: TransactionDto) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(transaction.id)) next.delete(transaction.id);
      else next.add(transaction.id);
      return next;
    });
  }

  function stopSelecting() {
    setSelecting(false);
    setChecked(new Set());
  }

  async function bulkDelete() {
    setBulkBusy(true);
    let done = 0;
    let queued = 0;
    let failed = 0;
    for (const id of checked) {
      try {
        const result = await submitOrQueue({ method: 'DELETE', path: `/transactions/${id}`, body: {}, workspaceId: activeWorkspaceId, userId: currentUserId });
        if (result.queued) queued++;
        else done++;
      } catch {
        failed++;
      }
    }
    invalidateLedger();
    setBulkBusy(false);
    setConfirmBulk(false);
    stopSelecting();
    const parts = [done && tr('transactions.countDeleted', { count: done }), queued && tr('transactions.countQueuedOffline', { count: queued }), failed && tr('transactions.countCouldNotDelete', { count: failed })].filter(Boolean);
    if (failed) toast.error(tr('transactions.someEntriesWereNotDeleted'), parts.join(' · '));
    else toast.success(tr('transactions.bulkDeleteFinished'), parts.join(' · '));
  }

  const debouncedSearch = useDebounced(search, 300);
  const debouncedTag = useDebounced(tag.trim().replace(/^#/, ''), 300);
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();

  const dateRange = useMemo(() => resolveRange(range), [range]);

  const params = useMemo(
    () => ({
      page,
      limit: 50,
      ...(range === 'all_time'
        ? {}
        : { from: dateRange.from.toISOString(), to: dateRange.to.toISOString() }),
      ...(types.length ? { types } : {}),
      ...(accountId ? { accountIds: [accountId] } : {}),
      ...(payee ? { payeeIds: [payee.id] } : {}),
      ...(categoryId ? { categoryIds: [categoryId] } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(showDeleted ? { onlyDeleted: true } : {}),
      ...(debouncedTag ? { tags: [debouncedTag] } : {}),
      ...(minAmountMinor !== null ? { minAmountMinor } : {}),
      ...(maxAmountMinor !== null ? { maxAmountMinor } : {}),
      ...(withReceipts ? { hasAttachment: true } : {}),
      ...(outstandingOnly ? { outstandingOnly: true } : {}),
      ...(claims ? { reimbursement: [...CLAIM_STAGES[claims]] } : {}),
    }),
    [page, range, dateRange, types, accountId, payee, categoryId, debouncedSearch, showDeleted, debouncedTag, minAmountMinor, maxAmountMinor, withReceipts, outstandingOnly, claims],
  );

  const { data, isLoading, isError, error, refetch, isPlaceholderData } = useTransactions(params);

  const activeFilterCount =
    types.length + (accountId ? 1 : 0) + (categoryId ? 1 : 0) + (showDeleted ? 1 : 0) +
    (debouncedTag ? 1 : 0) + (minAmountMinor !== null ? 1 : 0) + (maxAmountMinor !== null ? 1 : 0) +
    (withReceipts ? 1 : 0) + (outstandingOnly ? 1 : 0) + (claims ? 1 : 0);

  function resetFilters() {
    setTypes([]);
    setAccountId('');
    setPayee(null);
    setCategoryId('');
    setShowDeleted(false);
    setTag('');
    setMinAmountMinor(null);
    setMaxAmountMinor(null);
    setWithReceipts(false);
    setOutstandingOnly(false);
    setClaims('');
    setPage(1);
  }

  const items = useMemo(() => data?.page.items ?? [], [data]);
  const totals = data?.totals;

  // Group by day so the list reads as a diary rather than an undifferentiated feed.
  const grouped = useMemo(() => {
    const groups = new Map<string, TransactionDto[]>();
    for (const transaction of items) {
      const key = toDateKey(new Date(transaction.date));
      groups.set(key, [...(groups.get(key) ?? []), transaction]);
    }
    return [...groups.entries()];
  }, [items]);

  const flatCategories = useMemo(
    () =>
      categories.flatMap((category) => [
        { id: category.id, name: category.name, depth: 0 },
        ...(category.children ?? []).map((child) => ({ id: child.id, name: child.name, depth: 1 })),
      ]),
    [categories],
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{tr('nav.transactions')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {range === 'all_time'
              ? tr('transactions.everyEntryYouHaveRecorded')
              : `${formatDate(dateRange.from)} – ${formatDate(dateRange.to)}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {items.length > 0 && !showDeleted && (
            <Button variant="secondary" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
              {selecting ? tr('dashboard.done') : tr('transactions.select')}
            </Button>
          )}
          <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setQuickAddOpen(true)}>
            {tr('common.addTransaction')}
          </Button>
        </div>
      </header>

      {selecting && (
        <div role="status" className="sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-20 flex items-center justify-between gap-3 rounded-lg border border-gold/40 bg-gold-soft px-4 py-2.5 text-[13px]">
          <span className="font-medium text-ink">{checked.size} {tr('transactions.selected2')}</span>
          <Button size="sm" variant="danger" disabled={checked.size === 0} onClick={() => setConfirmBulk(true)}>
            {tr('transactions.deleteSelected')}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmBulk}
        onCancel={() => setConfirmBulk(false)}
        onConfirm={bulkDelete}
        busy={bulkBusy}
        tone="danger"
        title={tr.plural('transactions.deleteEntries', checked.size)}
        description={tr('transactions.theyMoveToTheTrashAnd')}
        confirmLabel={tr('common.delete')}
      />

      {/* Filters: one row, applied together (§24). */}
      <Card bare className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Full row on phones so the other controls can't squeeze it to nothing. */}
          <div className="min-w-0 grow basis-full sm:basis-0 sm:max-w-xs">
            <Input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={tr('transactions.searchNotesPeopleAmounts')}
              leftSlot={<Search aria-hidden className="size-4" />}
              aria-label={tr('transactions.searchTransactions')}
            />
          </div>

          <Select
            value={range}
            onChange={(event) => {
              setRange(event.target.value as RangePreset);
              setPage(1);
            }}
            aria-label={tr('common.dateRange')}
            className="w-auto min-w-[150px]"
          >
            {RANGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {tr.label('range', option, RANGE_PRESET_LABELS[option])}
              </option>
            ))}
          </Select>

          <Button
            variant={showFilters || activeFilterCount ? 'secondary' : 'ghost'}
            leftIcon={<Filter className="size-4" />}
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
          >
            {tr('transactions.filters')}
            {activeFilterCount > 0 && (
              <Badge tone="gold" className="ml-1.5">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        </div>

        {payee && (
          <p className="mt-3 flex">
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-gold bg-gold-soft py-1 pl-2.5 pr-1 text-[12px] font-medium text-gold-strong">
              {tr('transactions.payeeFilter', { name: payee.name || '…' })}
              <button
                type="button"
                aria-label={tr('transactions.removePayeeFilter')}
                onClick={() => {
                  setPayee(null);
                  setPage(1);
                }}
                className="rounded-sm p-1 hover:bg-gold/20"
              >
                <X aria-hidden className="size-3" />
              </button>
            </span>
          </p>
        )}

        {showFilters && (
          <div className="mt-4 flex flex-col gap-4 border-t border-line-faint pt-4">
            <div>
              <p className="label-eyebrow mb-2">{tr('reminders.form.type')}</p>
              <div className="flex flex-wrap gap-1.5">
                {TRANSACTION_TYPES.filter((type) => type !== 'adjustment').map((type) => {
                  const active = types.includes(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setTypes((current) =>
                          active ? current.filter((t) => t !== type) : [...current, type],
                        );
                        setPage(1);
                      }}
                      className={cn(
                        'rounded-sm border px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                        active
                          ? 'border-gold bg-gold-soft text-gold-strong'
                          : 'border-line bg-surface text-ink-muted hover:bg-sunken hover:text-ink',
                      )}
                    >
                      {tr.label('txType', type, TRANSACTION_META[type].label)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1.5">
                <span className="label-eyebrow">{tr('common.account')}</span>
                <Select
                  value={accountId}
                  onChange={(event) => {
                    setAccountId(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">{tr('common.allAccounts')}</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="label-eyebrow">{tr('common.category')}</span>
                <Select
                  value={categoryId}
                  onChange={(event) => {
                    setCategoryId(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">{tr('transactions.allCategories')}</option>
                  {flatCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.depth ? `\u00A0\u00A0\u00A0${category.name}` : category.name}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="flex items-center gap-2.5 self-end pb-2.5">
                <input
                  type="checkbox"
                  checked={showDeleted}
                  onChange={(event) => {
                    setShowDeleted(event.target.checked);
                    setPage(1);
                  }}
                  className="size-4 rounded-sm border-line text-gold focus:ring-gold"
                />
                <span className="flex items-center gap-1.5 text-[13px] text-ink-secondary">
                  <Trash2 aria-hidden className="size-3.5" />
                  {tr('transactions.showDeletedOnly')}
                </span>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1.5">
                <span className="label-eyebrow">{t('transactions.filter.tag')}</span>
                <Input
                  value={tag}
                  onChange={(event) => {
                    setTag(event.target.value);
                    setPage(1);
                  }}
                  placeholder={t('transactions.filter.tagPlaceholder')}
                  leftSlot={<Tag aria-hidden className="size-4" />}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="label-eyebrow">{t('transactions.filter.amountFrom')}</span>
                <MoneyInput
                  value={minAmountMinor}
                  onChange={(value) => {
                    setMinAmountMinor(value);
                    setPage(1);
                  }}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="label-eyebrow">{t('transactions.filter.amountTo')}</span>
                <MoneyInput
                  value={maxAmountMinor}
                  onChange={(value) => {
                    setMaxAmountMinor(value);
                    setPage(1);
                  }}
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={withReceipts}
                  onChange={(event) => {
                    setWithReceipts(event.target.checked);
                    setPage(1);
                  }}
                  className="size-4 rounded-sm border-line text-gold focus:ring-gold"
                />
                <span className="flex items-center gap-1.5 text-[13px] text-ink-secondary">
                  <Paperclip aria-hidden className="size-3.5" />
                  {t('transactions.filter.withReceipts')}
                </span>
              </label>
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={outstandingOnly}
                  onChange={(event) => {
                    setOutstandingOnly(event.target.checked);
                    setPage(1);
                  }}
                  className="size-4 rounded-sm border-line text-gold focus:ring-gold"
                />
                <span className="flex items-center gap-1.5 text-[13px] text-ink-secondary">
                  <HandCoins aria-hidden className="size-3.5" />
                  {t('transactions.filter.outstanding')}
                </span>
              </label>
            </div>

            <label className="flex w-fit flex-col gap-1.5 text-[12.5px] text-ink-secondary">
              {t('reimb.filter')}
              <Select
                value={claims}
                onChange={(event) => {
                  setClaims(event.target.value as typeof claims);
                  setPage(1);
                }}
                className="w-auto min-w-[200px]"
              >
                <option value="">{t('reimb.anyStage')}</option>
                <option value="all">{t('reimb.summaryTitle')}</option>
                <option value="owed">{t('reimb.outstanding')}</option>
                <option value="paid">{t('reimb.status.paid')}</option>
              </Select>
            </label>

            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={resetFilters}
                className="flex w-fit items-center gap-1.5 text-[12.5px] font-medium text-ink-muted transition-colors hover:text-negative"
              >
                <X aria-hidden className="size-3.5" />
                {tr('transactions.clearFilters')}
              </button>
            )}
          </div>
        )}
      </Card>

      {/* The summary reflects the active filters, not the whole ledger. */}
      {totals && totals.count > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
          <SummaryTile label={tr('common.income')} amountMinor={totals.totalIncomeMinor} tone="positive" />
          <SummaryTile label={tr('common.expenses')} amountMinor={totals.totalExpenseMinor} tone="negative" />
          <SummaryTile
            label={tr('common.net')}
            amountMinor={totals.netMinor}
            tone={totals.netMinor >= 0 ? 'positive' : 'negative'}
          />
        </div>
      )}

      <Card bare className={cn(isPlaceholderData && 'opacity-60 transition-opacity')}>
        {isLoading ? (
          <div className="p-5">
            <LoadingState rows={6} />
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Search className="size-5" />}
            title={
              debouncedSearch || activeFilterCount
                ? tr('transactions.nothingMatchesThoseFilters')
                : tr('common.noTransactionsYet')
            }
            description={
              debouncedSearch || activeFilterCount
                ? tr('transactions.tryAWiderDateRangeOr')
                : tr('transactions.startByRecordingYourFirstIncome')
            }
            action={
              debouncedSearch || activeFilterCount ? (
                <Button variant="secondary" size="sm" onClick={resetFilters}>
                  {tr('transactions.clearFilters')}
                </Button>
              ) : (
                <Button
                  variant="gold"
                  size="sm"
                  leftIcon={<Plus className="size-4" />}
                  onClick={() => setQuickAddOpen(true)}
                >
                  {tr('common.addTransaction')}
                </Button>
              )
            }
          />
        ) : (
          <>
            {grouped.map(([dateKey, dayTransactions]) => (
              <section key={dateKey}>
                <h2 className="sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-10 flex items-center justify-between gap-3 border-y border-line-faint bg-sunken/90 px-5 py-2 backdrop-blur-sm sm:px-6">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                    {relativeDay(dateKey)}
                  </span>
                  <span className="text-[11px] text-ink-faint">
                    {tr.plural('transactions.entryCount', dayTransactions.length)}
                  </span>
                </h2>
                <ul className="divide-y divide-line-faint">
                  {dayTransactions.map((transaction) => (
                    <TransactionRow
                      key={transaction.id}
                      transaction={transaction}
                      showDate
                      onClick={setSelected}
                      selection={selecting ? { checked: checked.has(transaction.id), onToggle: toggleChecked } : undefined}
                    />
                  ))}
                </ul>
              </section>
            ))}

            {data && data.page.totalPages > 1 && (
              <nav
                aria-label={tr('transactions.pagination')}
                className="flex items-center justify-between gap-3 border-t border-line px-5 py-4 sm:px-6"
              >
                <p className="text-[12.5px] text-ink-muted">
                  {tr('transactions.page')} {data.page.page} {tr('common.of')} {data.page.totalPages} · {data.page.total} {tr('transactions.entries')}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={data.page.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {tr('transactions.previous')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!data.page.hasMore}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {tr('transactions.next')}
                  </Button>
                </div>
              </nav>
            )}
          </>
        )}
      </Card>

      <TransactionDetailSheet
        // The list refetches after every change; show its fresh copy, not the snapshot taken at the click
        // (a stale `rev` would make the next change on the same entry fail as "changed somewhere else").
        transaction={selected ? (items.find((item) => item.id === selected.id) ?? selected) : null}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function SummaryTile({
  label,
  amountMinor,
  tone,
}: {
  label: string;
  amountMinor: number;
  tone: 'positive' | 'negative';
}) {
  return (
    // A compact label-and-figure row on phones; the original stacked tile from `sm`.
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-xs sm:block">
      <p className="label-eyebrow">{label}</p>
      <div className="sm:mt-1.5">
        <Money amountMinor={amountMinor} size="md" tone={amountMinor === 0 ? 'neutral' : tone} compactDecimals />
      </div>
    </div>
  );
}
