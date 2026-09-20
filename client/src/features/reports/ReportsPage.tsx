import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileBarChart, TrendingDown, TrendingUp } from 'lucide-react';
import { formatMoney, formatPercent } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Card, CardHeader } from '../../components/ui/Card';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { Dot } from '../../components/ui/Badge';
import { Icon } from '../../components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useBorrowLendReport, useCategoryReport, useMonthlyComparison, useNetWorth } from '../../lib/queries3';
import { useCurrency } from '../../hooks/useCurrency';
import { NetWorthChart } from './NetWorthChart';
import { MonthlyComparisonChart } from './MonthlyComparisonChart';
import { ShareButton } from '../../components/ShareButton';

type Tab = 'overview' | 'categories' | 'net-worth' | 'borrow-lend' | 'monthly' | 'annual';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'categories', label: 'By Category' },
  { id: 'net-worth', label: 'Net Worth' },
  { id: 'monthly', label: 'Monthly Comparison' },
  { id: 'annual', label: 'Annual Summary' },
  { id: 'borrow-lend', label: 'Borrow & Lend' },
];

/**
 * Reports (§27).
 *
 * A tabbed statement rather than a dozen separate pages: every report here reads
 * the same live ledger, so switching tabs never shows a number that contradicts
 * another tab. Category, net worth, monthly comparison and borrow/lend cover the
 * reports users reach for daily; the cash book (§10) and person ledgers (§13)
 * already have their own dedicated, more detailed pages.
 */
export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'overview';

  function setTab(next: Tab) {
    setParams((current) => {
      const updated = new URLSearchParams(current);
      updated.set('tab', next);
      return updated;
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">Reports</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">Statements built from your actual ledger, always current.</p>
        </div>
      </header>

      <div className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={cn(
              'shrink-0 whitespace-nowrap rounded-md px-3.5 py-2 text-[13px] font-medium transition-colors',
              tab === t.id ? 'bg-ink text-ink-inverse' : 'text-ink-muted hover:bg-sunken hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'categories' && <CategoryTab />}
      {tab === 'net-worth' && <NetWorthTab />}
      {tab === 'monthly' && <MonthlyTab />}
      {tab === 'annual' && <AnnualSummaryTab />}
      {tab === 'borrow-lend' && <BorrowLendTab />}
    </div>
  );
}

type CategoryRow = {
  categoryId: string | null;
  name: string;
  icon: string;
  color: string;
  amountMinor: number;
  percentOfTotal: number;
};

function AnnualSummaryTab() {
  const [year, setYear] = useState<'this_year' | 'last_year'>('this_year');
  const currency = useCurrency();

  const { data: incomeData, isLoading: incomeLoading, isError: incomeError, error: incomeErr, refetch: refetchIncome } =
    useCategoryReport('income', year);
  const { data: expenseData, isLoading: expenseLoading, isError: expenseError, error: expenseErr, refetch: refetchExpense } =
    useCategoryReport('expense', year);

  const isLoading = incomeLoading || expenseLoading;
  const isError = incomeError || expenseError;

  const incomeRows = (incomeData as CategoryRow[]) ?? [];
  const expenseRows = (expenseData as CategoryRow[]) ?? [];
  const totalIncomeMinor = incomeRows.reduce((sum, row) => sum + row.amountMinor, 0);
  const totalExpenseMinor = expenseRows.reduce((sum, row) => sum + row.amountMinor, 0);
  const netSavingsMinor = totalIncomeMinor - totalExpenseMinor;
  const savingsRate = totalIncomeMinor > 0 ? (netSavingsMinor / totalIncomeMinor) * 100 : 0;
  const yearLabel = year === 'this_year' ? 'This year' : 'Last year';

  const shareText = [
    `${yearLabel} summary`,
    `Income: ${formatMoney(totalIncomeMinor, { currency, compactDecimals: true })}`,
    `Expenses: ${formatMoney(totalExpenseMinor, { currency, compactDecimals: true })}`,
    `Net savings: ${formatMoney(netSavingsMinor, { currency, compactDecimals: true })} (${formatPercent(Math.max(savingsRate, 0))} savings rate)`,
    ...(expenseRows.length > 0
      ? ['', 'Top expenses:', ...expenseRows.slice(0, 3).map((r) => `- ${r.name}: ${formatMoney(r.amountMinor, { currency, compactDecimals: true })}`)]
      : []),
  ].join('\n');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md border border-line bg-surface p-0.5">
          {(['this_year', 'last_year'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setYear(option)}
              aria-pressed={year === option}
              className={cn(
                'rounded-sm px-3.5 py-1.5 text-[12.5px] font-medium transition-colors',
                year === option ? 'bg-ink text-ink-inverse' : 'text-ink-muted hover:bg-sunken',
              )}
            >
              {option === 'this_year' ? 'This Year' : 'Last Year'}
            </button>
          ))}
        </div>
        {!isLoading && !isError && (
          <ShareButton content={{ title: 'Khata — Annual Summary', text: shareText }} label="Share summary" />
        )}
      </div>

      {isLoading ? (
        <Card>
          <LoadingState rows={5} />
        </Card>
      ) : isError ? (
        <Card>
          <ErrorState error={incomeErr ?? expenseErr} onRetry={() => { void refetchIncome(); void refetchExpense(); }} />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={`${yearLabel} income`} amountMinor={totalIncomeMinor} tone="positive" />
            <StatCard label={`${yearLabel} expenses`} amountMinor={totalExpenseMinor} tone="negative" />
            <StatCard label="Net savings" amountMinor={netSavingsMinor} tone={netSavingsMinor >= 0 ? 'positive' : 'negative'} />
            <div className="rounded-lg border border-line bg-surface px-4 py-3.5 shadow-xs">
              <p className="label-eyebrow">Savings rate</p>
              <div className="mt-1.5 text-[18px] font-semibold tabular text-ink">
                {formatPercent(Math.max(savingsRate, 0))}
              </div>
            </div>
          </div>

          {totalIncomeMinor === 0 && totalExpenseMinor === 0 ? (
            <Card>
              <EmptyState
                icon={<FileBarChart className="size-5" />}
                title={`No activity ${year === 'this_year' ? 'this year' : 'last year'}`}
                description="Once income or expenses are recorded, the annual summary appears here."
              />
            </Card>
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              <AnnualCategoryList title="Top income sources" rows={incomeRows} />
              <AnnualCategoryList title="Top expense categories" rows={expenseRows} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AnnualCategoryList({ title, rows }: { title: string; rows: CategoryRow[] }) {
  const top = [...rows].sort((a, b) => b.amountMinor - a.amountMinor).slice(0, 8);

  return (
    <Card bare>
      <div className="p-5 pb-3 sm:p-6 sm:pb-3">
        <CardHeader eyebrow="Annual" title={title} />
      </div>
      {top.length === 0 ? (
        <p className="border-t border-line-faint px-5 py-4 text-[12.5px] text-ink-muted sm:px-6">Nothing recorded.</p>
      ) : (
        <ul className="divide-y divide-line-faint border-t border-line-faint">
          {top.map((row) => (
            <li key={row.categoryId ?? 'none'} className="flex items-center gap-3 px-5 py-3 sm:px-6">
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-md"
                style={{ backgroundColor: `${row.color}1F`, color: row.color }}
              >
                <Icon name={row.icon} className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{row.name}</span>
              <Money amountMinor={row.amountMinor} size="sm" tone="neutral" compactDecimals />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function OverviewTab() {
  const { data: netWorth, isLoading: nwLoading } = useNetWorth(6);
  const { data: comparison, isLoading: cmpLoading } = useMonthlyComparison(6);
  const currency = useCurrency();

  const latestMonth = comparison?.at(-1);
  const previousMonth = comparison?.at(-2);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Net worth" amountMinor={netWorth?.netWorthMinor ?? 0} loading={nwLoading} />
        <StatCard label="This month's income" amountMinor={latestMonth?.incomeMinor ?? 0} tone="positive" loading={cmpLoading} />
        <StatCard label="This month's expenses" amountMinor={latestMonth?.expenseMinor ?? 0} tone="negative" loading={cmpLoading} />
      </div>

      <Card bare>
        <div className="p-5 pb-3 sm:p-6 sm:pb-3">
          <CardHeader eyebrow="Trend" title="Net worth, last 6 months" />
        </div>
        {nwLoading ? (
          <div className="p-5">
            <LoadingState rows={3} />
          </div>
        ) : (
          <NetWorthChart history={netWorth?.history ?? []} />
        )}
      </Card>

      {latestMonth && previousMonth && (
        <Card>
          <CardHeader eyebrow="Comparison" title={`${latestMonth.label} vs ${previousMonth.label}`} />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <ComparisonRow label="Income" current={latestMonth.incomeMinor} previous={previousMonth.incomeMinor} currency={currency} goodIsUp />
            <ComparisonRow label="Expenses" current={latestMonth.expenseMinor} previous={previousMonth.expenseMinor} currency={currency} goodIsUp={false} />
          </div>
        </Card>
      )}
    </div>
  );
}

function ComparisonRow({
  label,
  current,
  previous,
  currency,
  goodIsUp,
}: {
  label: string;
  current: number;
  previous: number;
  currency: string;
  goodIsUp: boolean;
}) {
  const delta = current - previous;
  const percent = previous > 0 ? (delta / previous) * 100 : 0;
  const isGood = goodIsUp ? delta >= 0 : delta <= 0;

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="label-eyebrow">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="sensitive tabular text-[18px] font-semibold text-ink">
          {formatMoney(current, { currency, compactDecimals: true })}
        </span>
        {previous > 0 && (
          <span className={cn('flex items-center gap-0.5 text-[12px] font-medium', isGood ? 'text-positive' : 'text-negative')}>
            {delta >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
            {formatPercent(Math.abs(percent))}
          </span>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  amountMinor,
  tone = 'neutral',
  loading,
}: {
  label: string;
  amountMinor: number;
  tone?: 'positive' | 'negative' | 'neutral';
  loading?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3.5 shadow-xs">
      <p className="label-eyebrow">{label}</p>
      <div className="mt-1.5">
        {loading ? (
          <div className="skeleton h-6 w-24" />
        ) : (
          <Money amountMinor={amountMinor} size="lg" tone={tone} compactDecimals />
        )}
      </div>
    </div>
  );
}

function CategoryTab() {
  const [kind, setKind] = useState<'income' | 'expense'>('expense');
  const { data, isLoading, isError, error, refetch } = useCategoryReport(kind, 'this_month');
  const rows = (data as Array<{ categoryId: string | null; name: string; icon: string; color: string; amountMinor: number; percentOfTotal: number; changePercent: number }>) ?? [];

  return (
    <Card bare>
      <div className="flex items-center justify-between gap-3 p-5 pb-3 sm:p-6 sm:pb-3">
        <CardHeader eyebrow="This month" title="Spending by category" />
        <div className="flex rounded-md border border-line bg-surface p-0.5">
          {(['expense', 'income'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setKind(option)}
              aria-pressed={kind === option}
              className={cn('rounded-sm px-3 py-1.5 text-[12px] font-medium capitalize transition-colors', kind === option ? 'bg-ink text-ink-inverse' : 'text-ink-muted hover:bg-sunken')}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="p-5">
          <LoadingState rows={5} />
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<FileBarChart className="size-5" />} title="Nothing this month" description={`No ${kind} recorded yet this month.`} />
      ) : (
        <ul className="divide-y divide-line-faint border-t border-line-faint">
          {rows.map((row) => (
            <li key={row.categoryId ?? 'none'} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: `${row.color}1F`, color: row.color }}>
                <Icon name={row.icon} className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-[13px] font-medium text-ink">{row.name}</span>
                  <Money amountMinor={row.amountMinor} size="sm" tone="neutral" compactDecimals />
                </div>
                <div aria-hidden className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken">
                  <div className="h-full rounded-full" style={{ width: `${row.percentOfTotal}%`, backgroundColor: row.color }} />
                </div>
              </div>
              <span className="w-12 shrink-0 text-right text-[11.5px] text-ink-muted">{formatPercent(row.percentOfTotal, 0)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function NetWorthTab() {
  const { data, isLoading, isError, error, refetch } = useNetWorth(12);

  if (isLoading) return <Card><LoadingState rows={4} /></Card>;
  if (isError) return <Card><ErrorState error={error} onRetry={() => void refetch()} /></Card>;
  if (!data) return null;

  const rows: Array<[string, number, string]> = [
    ['Cash', data.breakdown.cashMinor, 'positive'],
    ['Bank / UPI / Wallet', data.breakdown.bankMinor, 'positive'],
    ['Savings', data.breakdown.savingsMinor, 'positive'],
    ['Investments', data.breakdown.investmentMinor, 'positive'],
    ['Receivables', data.breakdown.receivablesMinor, 'positive'],
    ['Credit card debt', data.breakdown.creditCardMinor, 'negative'],
    ['Payables', data.breakdown.payablesMinor, 'negative'],
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Assets" amountMinor={data.assetsMinor} tone="positive" />
        <StatCard label="Liabilities" amountMinor={data.liabilitiesMinor} tone="negative" />
        <StatCard label="Net worth" amountMinor={data.netWorthMinor} />
      </div>

      <Card bare>
        <div className="p-5 pb-3 sm:p-6 sm:pb-3">
          <CardHeader eyebrow="12 months" title="Net worth trend" />
        </div>
        <NetWorthChart history={data.history} />
      </Card>

      <Card>
        <CardHeader eyebrow="Breakdown" title="Assets and liabilities" />
        <ul className="mt-4 flex flex-col divide-y divide-line-faint">
          {rows.filter(([, amount]) => amount !== 0).map(([label, amount, tone]) => (
            <li key={label} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex items-center gap-2 text-[13px] text-ink-secondary">
                <Dot color={tone === 'positive' ? '#2F7A5C' : '#A8443C'} />
                {label}
              </span>
              <Money amountMinor={amount} size="sm" tone={tone as 'positive' | 'negative'} compactDecimals />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function MonthlyTab() {
  const { data, isLoading, isError, error, refetch } = useMonthlyComparison(12);

  if (isLoading) return <Card><LoadingState rows={4} /></Card>;
  if (isError) return <Card><ErrorState error={error} onRetry={() => void refetch()} /></Card>;
  if (!data || data.length === 0) return null;

  return (
    <Card bare>
      <div className="p-5 pb-3 sm:p-6 sm:pb-3">
        <CardHeader eyebrow="Last 12 months" title="Income vs expenses" />
      </div>
      <MonthlyComparisonChart rows={data} />
      <div className="overflow-x-auto border-t border-line-faint">
        <table className="w-full min-w-[560px] text-left">
          <thead>
            <tr className="border-b border-line bg-sunken/60">
              <th scope="col" className="label-eyebrow px-5 py-2.5 sm:px-6">Month</th>
              <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">Income</th>
              <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">Expenses</th>
              <th scope="col" className="label-eyebrow px-5 py-2.5 text-right sm:px-6">Net</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={`${row.year}-${row.month}`} className="border-b border-line-faint last:border-0">
                <td className="px-5 py-2.5 text-[12.5px] text-ink-secondary sm:px-6">{row.label}</td>
                <td className="px-3 py-2.5 text-right"><Money amountMinor={row.incomeMinor} size="sm" tone="positive" compactDecimals /></td>
                <td className="px-3 py-2.5 text-right"><Money amountMinor={row.expenseMinor} size="sm" tone="negative" compactDecimals /></td>
                <td className="px-5 py-2.5 text-right sm:px-6"><Money amountMinor={row.netMinor} size="sm" tone={row.netMinor >= 0 ? 'positive' : 'negative'} weight="medium" compactDecimals /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function BorrowLendTab() {
  const { data = [], isLoading, isError, error, refetch } = useBorrowLendReport();

  if (isLoading) return <Card><LoadingState rows={4} /></Card>;
  if (isError) return <Card><ErrorState error={error} onRetry={() => void refetch()} /></Card>;
  if (data.length === 0) {
    return (
      <Card>
        <EmptyState icon={<FileBarChart className="size-5" />} title="No lending activity" description="Lend, borrow and repayment history with each person appears here." />
      </Card>
    );
  }

  return (
    <Card bare>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead>
            <tr className="border-b border-line bg-sunken/60">
              <th scope="col" className="label-eyebrow px-5 py-2.5 sm:px-6">Person</th>
              <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">Lent</th>
              <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">Borrowed</th>
              <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">Repaid to you</th>
              <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">Repaid by you</th>
              <th scope="col" className="label-eyebrow px-5 py-2.5 text-right sm:px-6">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.personId} className="border-b border-line-faint last:border-0 hover:bg-sunken/40">
                <td className="px-5 py-3 sm:px-6">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-ink">{row.personName}</span>
                    <Badge tone={row.status === 'receivable' ? 'positive' : row.status === 'payable' ? 'negative' : 'neutral'} eyebrow>
                      {row.status}
                    </Badge>
                  </span>
                </td>
                <td className="px-3 py-3 text-right"><Money amountMinor={row.totalLentMinor} size="sm" tone="neutral" compactDecimals /></td>
                <td className="px-3 py-3 text-right"><Money amountMinor={row.totalBorrowedMinor} size="sm" tone="neutral" compactDecimals /></td>
                <td className="px-3 py-3 text-right"><Money amountMinor={row.totalRepaidToYouMinor} size="sm" tone="neutral" compactDecimals /></td>
                <td className="px-3 py-3 text-right"><Money amountMinor={row.totalRepaidByYouMinor} size="sm" tone="neutral" compactDecimals /></td>
                <td className="px-5 py-3 text-right sm:px-6">
                  <Money amountMinor={Math.abs(row.outstandingMinor)} size="sm" tone={row.status === 'receivable' ? 'positive' : row.status === 'payable' ? 'negative' : 'neutral'} weight="medium" compactDecimals />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
