import { useMemo, useState } from 'react';
import { Filter, Plus, Search, Trash2, X } from 'lucide-react';
import {
  RANGE_PRESET_LABELS,
  TRANSACTION_META,
  TRANSACTION_TYPES,
  formatDate,
  relativeDay,
  resolveRange,
  toDateKey,
  type RangePreset,
  type TransactionDto,
  type TransactionType,
} from '@khata/shared';
import { cn } from '../../lib/cn';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useAccounts, useCategories, useTransactions } from '../../lib/queries';
import { useUiStore } from '../../stores/ui.store';
import { useDebounced } from '../../hooks/useDebounced';
import { TransactionRow } from './TransactionRow';
import { TransactionDetailSheet } from './TransactionDetailSheet';

const RANGE_OPTIONS: RangePreset[] = [
  'this_month', 'last_month', 'last_7_days', 'last_30_days',
  'last_3_months', 'this_year', 'all_time',
];

/**
 * The transaction list (§23, §24).
 *
 * Filters are a single row above the list, applied together, and the summary
 * updates with them — so "how much did I spend on fuel in August" is answered by
 * the header rather than by the user adding numbers up themselves.
 */
export function TransactionsPage() {
  const setQuickAddOpen = useUiStore((s) => s.setQuickAddOpen);

  const [search, setSearch] = useState('');
  const [range, setRange] = useState<RangePreset>('this_month');
  const [types, setTypes] = useState<TransactionType[]>([]);
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<TransactionDto | null>(null);

  const debouncedSearch = useDebounced(search, 300);
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
      ...(categoryId ? { categoryIds: [categoryId] } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(showDeleted ? { onlyDeleted: true } : {}),
    }),
    [page, range, dateRange, types, accountId, categoryId, debouncedSearch, showDeleted],
  );

  const { data, isLoading, isError, error, refetch, isPlaceholderData } = useTransactions(params);

  const activeFilterCount =
    types.length + (accountId ? 1 : 0) + (categoryId ? 1 : 0) + (showDeleted ? 1 : 0);

  function resetFilters() {
    setTypes([]);
    setAccountId('');
    setCategoryId('');
    setShowDeleted(false);
    setPage(1);
  }

  const items = data?.page.items ?? [];
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
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">Transactions</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {range === 'all_time'
              ? 'Every entry you have recorded'
              : `${formatDate(dateRange.from)} – ${formatDate(dateRange.to)}`}
          </p>
        </div>

        <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setQuickAddOpen(true)}>
          Add transaction
        </Button>
      </header>

      {/* Filters: one row, applied together (§24). */}
      <Card bare className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <Input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search notes, people, amounts…"
              leftSlot={<Search aria-hidden className="size-4" />}
              aria-label="Search transactions"
            />
          </div>

          <Select
            value={range}
            onChange={(event) => {
              setRange(event.target.value as RangePreset);
              setPage(1);
            }}
            aria-label="Date range"
            className="w-auto min-w-[150px]"
          >
            {RANGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {RANGE_PRESET_LABELS[option]}
              </option>
            ))}
          </Select>

          <Button
            variant={showFilters || activeFilterCount ? 'secondary' : 'ghost'}
            leftIcon={<Filter className="size-4" />}
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
          >
            Filters
            {activeFilterCount > 0 && (
              <Badge tone="gold" className="ml-1.5">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        </div>

        {showFilters && (
          <div className="mt-4 flex flex-col gap-4 border-t border-line-faint pt-4">
            <div>
              <p className="label-eyebrow mb-2">Type</p>
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
                      {TRANSACTION_META[type].label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1.5">
                <span className="label-eyebrow">Account</span>
                <Select
                  value={accountId}
                  onChange={(event) => {
                    setAccountId(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All accounts</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="label-eyebrow">Category</span>
                <Select
                  value={categoryId}
                  onChange={(event) => {
                    setCategoryId(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All categories</option>
                  {flatCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.depth ? `   ${category.name}` : category.name}
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
                  Show deleted only
                </span>
              </label>
            </div>

            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={resetFilters}
                className="flex w-fit items-center gap-1.5 text-[12.5px] font-medium text-ink-muted transition-colors hover:text-negative"
              >
                <X aria-hidden className="size-3.5" />
                Clear filters
              </button>
            )}
          </div>
        )}
      </Card>

      {/* The summary reflects the active filters, not the whole ledger. */}
      {totals && totals.count > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <SummaryTile label="Income" amountMinor={totals.totalIncomeMinor} tone="positive" />
          <SummaryTile label="Expenses" amountMinor={totals.totalExpenseMinor} tone="negative" />
          <SummaryTile
            label="Net"
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
                ? 'Nothing matches those filters'
                : 'No transactions yet'
            }
            description={
              debouncedSearch || activeFilterCount
                ? 'Try a wider date range, or clear the filters to see everything.'
                : 'Start by recording your first income or expense. It only takes a few seconds.'
            }
            action={
              debouncedSearch || activeFilterCount ? (
                <Button variant="secondary" size="sm" onClick={resetFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button
                  variant="gold"
                  size="sm"
                  leftIcon={<Plus className="size-4" />}
                  onClick={() => setQuickAddOpen(true)}
                >
                  Add transaction
                </Button>
              )
            }
          />
        ) : (
          <>
            {grouped.map(([dateKey, dayTransactions]) => (
              <section key={dateKey}>
                <h2 className="sticky top-16 z-10 flex items-center justify-between gap-3 border-y border-line-faint bg-sunken/90 px-5 py-2 backdrop-blur-sm sm:px-6">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                    {relativeDay(dateKey)}
                  </span>
                  <span className="text-[11px] text-ink-faint">
                    {dayTransactions.length} {dayTransactions.length === 1 ? 'entry' : 'entries'}
                  </span>
                </h2>
                <ul className="divide-y divide-line-faint">
                  {dayTransactions.map((transaction) => (
                    <TransactionRow
                      key={transaction.id}
                      transaction={transaction}
                      showDate
                      onClick={setSelected}
                    />
                  ))}
                </ul>
              </section>
            ))}

            {data && data.page.totalPages > 1 && (
              <nav
                aria-label="Pagination"
                className="flex items-center justify-between gap-3 border-t border-line px-5 py-4 sm:px-6"
              >
                <p className="text-[12.5px] text-ink-muted">
                  Page {data.page.page} of {data.page.totalPages} · {data.page.total} entries
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={data.page.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!data.page.hasMore}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </nav>
            )}
          </>
        )}
      </Card>

      <TransactionDetailSheet
        transaction={selected}
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
    <div className="rounded-lg border border-line bg-surface px-4 py-3 shadow-xs">
      <p className="label-eyebrow">{label}</p>
      <div className="mt-1.5">
        <Money amountMinor={amountMinor} size="md" tone={amountMinor === 0 ? 'neutral' : tone} compactDecimals />
      </div>
    </div>
  );
}
