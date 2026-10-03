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
import { useBorrowLendReport, useCategoryReport, useForecast, useMonthlyComparison, useNetWorth } from '../../lib/queries3';
import { useProfitAndLoss, useAgeingReport, useGstSummary } from '../../lib/queries4';
import { useCurrency } from '../../hooks/useCurrency';
import { useAuthStore } from '../../stores/auth.store';
import { NetWorthChart } from './NetWorthChart';
import { MonthlyComparisonChart } from './MonthlyComparisonChart';
import { ForecastChart } from './ForecastChart';
import { ShareButton } from '../../components/ShareButton';
import { useT, msg, type MessageRef } from '../../i18n';
import { ScrollRegion } from '../../components/ui/ScrollRegion';
import { ReportBuilderTab } from './ReportBuilderTab';
import { ReimbursementsTab } from './ReimbursementsTab';

type Tab = 'overview' | 'categories' | 'net-worth' | 'forecast' | 'borrow-lend' | 'monthly' | 'annual' | 'profit-loss' | 'ageing' | 'gst' | 'builder' | 'reimbursements';

const TABS: Array<{ id: Tab; label: MessageRef; businessOnly?: boolean }> = [
  { id: 'overview', label: msg('reports.overview') },
  { id: 'categories', label: msg('reports.byCategory') },
  { id: 'net-worth', label: msg('reports.netWorth') },
  { id: 'forecast', label: msg('reports.tabCashFlowForecast') },
  { id: 'monthly', label: msg('reports.monthlyComparison') },
  { id: 'annual', label: msg('reports.annualSummary') },
  { id: 'borrow-lend', label: msg('reports.borrowLend') },
  { id: 'reimbursements', label: msg('reports.tabReimbursements') },
  { id: 'builder', label: msg('reports.tabBuilder') },
  { id: 'profit-loss', label: msg('reports.profitLoss'), businessOnly: true },
  { id: 'ageing', label: msg('reports.ageing'), businessOnly: true },
  { id: 'gst', label: msg('reports.tabGstSummary'), businessOnly: true },
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
  const tr = useT();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'overview';
  const mode = useAuthStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.mode ?? 'personal');
  const visibleTabs = TABS.filter((t) => !t.businessOnly || mode === 'business');

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
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{tr('nav.reports')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">{tr('reports.statementsBuiltFromYourActualLedger')}</p>
        </div>
      </header>

      <div className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {visibleTabs.map((t) => (
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
            {tr(t.label.key)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'categories' && <CategoryTab />}
      {tab === 'net-worth' && <NetWorthTab />}
      {tab === 'forecast' && <ForecastTab />}
      {tab === 'monthly' && <MonthlyTab />}
      {tab === 'annual' && <AnnualSummaryTab />}
      {tab === 'borrow-lend' && <BorrowLendTab />}
      {tab === 'reimbursements' && <ReimbursementsTab />}
      {tab === 'builder' && <ReportBuilderTab />}
      {tab === 'profit-loss' && mode === 'business' && <ProfitAndLossTab />}
      {tab === 'ageing' && mode === 'business' && <AgeingTab />}
      {tab === 'gst' && mode === 'business' && <GstSummaryTab />}
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
  const tr = useT();
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
  const yearLabel = year === 'this_year' ? tr('reports.thisYear') : tr('reports.lastYear');

  const shareText = [
    tr('reports.yearSummary', { year: yearLabel }),
    tr('reports.incomeLine', { amount: formatMoney(totalIncomeMinor, { currency, compactDecimals: true }) }),
    tr('reports.expensesLine', { amount: formatMoney(totalExpenseMinor, { currency, compactDecimals: true }) }),
    tr('reports.netSavingsLine', { amount: formatMoney(netSavingsMinor, { currency, compactDecimals: true }), rate: formatPercent(Math.max(savingsRate, 0)) }),
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
              {option === 'this_year' ? tr('reports.thisYear2') : tr('reports.lastYear2')}
            </button>
          ))}
        </div>
        {!isLoading && !isError && (
          <ShareButton content={{ title: tr('reports.khataAnnualSummary'), text: shareText }} label={tr('reports.shareSummary')} />
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={tr('reports.income', { yearLabel })} amountMinor={totalIncomeMinor} tone="positive" />
            <StatCard label={tr('reports.expenses', { yearLabel })} amountMinor={totalExpenseMinor} tone="negative" />
            <StatCard label={tr('common.netSavings')} amountMinor={netSavingsMinor} tone={netSavingsMinor >= 0 ? 'positive' : 'negative'} />
            <div className="rounded-lg border border-line bg-surface px-4 py-3.5 shadow-xs">
              <p className="label-eyebrow">{tr('common.savingsRate')}</p>
              <div className="mt-1.5 text-[18px] font-semibold tabular text-ink">
                {formatPercent(Math.max(savingsRate, 0))}
              </div>
            </div>
          </div>

          {totalIncomeMinor === 0 && totalExpenseMinor === 0 ? (
            <Card>
              <EmptyState
                icon={<FileBarChart className="size-5" />}
                title={tr(year === 'this_year' ? 'reports.noActivityThisYear' : 'reports.noActivityLastYear')}
                description={tr('reports.onceIncomeOrExpensesAreRecorded')}
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <AnnualCategoryList title={tr('reports.topIncomeSources')} rows={incomeRows} />
              <AnnualCategoryList title={tr('reports.topExpenseCategories')} rows={expenseRows} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AnnualCategoryList({ title, rows }: { title: string; rows: CategoryRow[] }) {
  const tr = useT();
  const top = [...rows].sort((a, b) => b.amountMinor - a.amountMinor).slice(0, 8);

  return (
    <Card bare>
      <div className="p-5 pb-3 sm:p-6 sm:pb-3">
        <CardHeader eyebrow={tr('reports.annual')} title={title} />
      </div>
      {top.length === 0 ? (
        <p className="border-t border-line-faint px-5 py-4 text-[12.5px] text-ink-muted sm:px-6">{tr('reports.nothingRecorded')}</p>
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
  const tr = useT();
  const { data: netWorth, isLoading: nwLoading } = useNetWorth(6);
  const { data: comparison, isLoading: cmpLoading } = useMonthlyComparison(6);
  const currency = useCurrency();

  const latestMonth = comparison?.at(-1);
  const previousMonth = comparison?.at(-2);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={tr('common.netWorth')} amountMinor={netWorth?.netWorthMinor ?? 0} loading={nwLoading} />
        <StatCard label={tr('reports.thisMonthSIncome')} amountMinor={latestMonth?.incomeMinor ?? 0} tone="positive" loading={cmpLoading} />
        <StatCard label={tr('reports.thisMonthSExpenses')} amountMinor={latestMonth?.expenseMinor ?? 0} tone="negative" loading={cmpLoading} />
      </div>

      <Card bare>
        <div className="p-5 pb-3 sm:p-6 sm:pb-3">
          <CardHeader eyebrow={tr('reports.trend')} title={tr('reports.netWorthLast6Months')} />
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
          <CardHeader eyebrow={tr('reports.comparison')} title={tr('reports.vs', { label: latestMonth.label, label2: previousMonth.label })} />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ComparisonRow label={tr('common.income')} current={latestMonth.incomeMinor} previous={previousMonth.incomeMinor} currency={currency} goodIsUp />
            <ComparisonRow label={tr('common.expenses')} current={latestMonth.expenseMinor} previous={previousMonth.expenseMinor} currency={currency} goodIsUp={false} />
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
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
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
  const tr = useT();
  const [kind, setKind] = useState<'income' | 'expense'>('expense');
  const { data, isLoading, isError, error, refetch } = useCategoryReport(kind, 'this_month');
  const rows = (data as Array<{ categoryId: string | null; name: string; icon: string; color: string; amountMinor: number; percentOfTotal: number; changePercent: number }>) ?? [];

  return (
    <Card bare>
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3 sm:p-6 sm:pb-3">
        <CardHeader eyebrow={tr('common.thisMonth')} title={tr('reports.spendingByCategory')} />
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
        <EmptyState icon={<FileBarChart className="size-5" />} title={tr('reports.nothingThisMonth')} description={tr('reports.noRecordedYetThisMonth', { kind })} />
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

function ForecastTab() {
  const tr = useT();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const { data, isLoading, isError, error, refetch } = useForecast(days);

  if (isLoading) return <Card><LoadingState rows={4} /></Card>;
  if (isError) return <Card><ErrorState error={error} onRetry={() => void refetch()} /></Card>;
  if (!data) return null;

  const lowest = data.points.reduce((min, p) => Math.min(min, p.projectedBalanceMinor), data.startingBalanceMinor);
  const ending = data.points[data.points.length - 1]?.projectedBalanceMinor ?? data.startingBalanceMinor;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-1">
        {([7, 30, 90] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setDays(option)}
            aria-pressed={days === option}
            className={cn(
              'rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors',
              days === option ? 'bg-ink text-ink-inverse' : 'text-ink-muted hover:bg-sunken hover:text-ink',
            )}
          >
            {option} {tr('reports.days')}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={tr('reports.today')} amountMinor={data.startingBalanceMinor} />
        <StatCard label={tr('reports.inDaysEstimate', { days })} amountMinor={ending} />
        <StatCard label={tr('reports.lowestPointEstimate')} amountMinor={lowest} tone={lowest < 0 ? 'negative' : undefined} />
      </div>

      <Card bare>
        <div className="p-5 pb-3 sm:p-6 sm:pb-3">
          <CardHeader eyebrow={tr('reports.projectionNotAnActualBalance')} title={tr('reports.cashFlowForecast')} />
          <p className="mt-1 text-[12px] text-ink-muted">
            {tr('reports.builtFromYourScheduledRecurringIncome')}
          </p>
        </div>
        <ForecastChart points={data.points} />
      </Card>
    </div>
  );
}

function NetWorthTab() {
  const tr = useT();
  const { data, isLoading, isError, error, refetch } = useNetWorth(12);

  if (isLoading) return <Card><LoadingState rows={4} /></Card>;
  if (isError) return <Card><ErrorState error={error} onRetry={() => void refetch()} /></Card>;
  if (!data) return null;

  const rows: Array<[string, number, string]> = [
    [tr('reports.cash'), data.breakdown.cashMinor, 'positive'],
    [tr('reports.bankUpiWallet'), data.breakdown.bankMinor, 'positive'],
    [tr('reports.savings'), data.breakdown.savingsMinor, 'positive'],
    [tr('reports.investments'), data.breakdown.investmentMinor, 'positive'],
    [tr('dashboard.receivables'), data.breakdown.receivablesMinor, 'positive'],
    [tr('reports.creditCardDebt'), data.breakdown.creditCardMinor, 'negative'],
    [tr('dashboard.payables'), data.breakdown.payablesMinor, 'negative'],
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={tr('common.assets')} amountMinor={data.assetsMinor} tone="positive" />
        <StatCard label={tr('common.liabilities')} amountMinor={data.liabilitiesMinor} tone="negative" />
        <StatCard label={tr('common.netWorth')} amountMinor={data.netWorthMinor} />
      </div>

      <Card bare>
        <div className="p-5 pb-3 sm:p-6 sm:pb-3">
          <CardHeader eyebrow={tr('reports.12Months')} title={tr('reports.netWorthTrend')} />
        </div>
        <NetWorthChart history={data.history} />
      </Card>

      <Card>
        <CardHeader eyebrow={tr('reports.breakdown')} title={tr('reports.assetsAndLiabilities')} />
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
  const tr = useT();
  const { data, isLoading, isError, error, refetch } = useMonthlyComparison(12);

  if (isLoading) return <Card><LoadingState rows={4} /></Card>;
  if (isError) return <Card><ErrorState error={error} onRetry={() => void refetch()} /></Card>;
  if (!data || data.length === 0) return null;

  return (
    <Card bare>
      <div className="p-5 pb-3 sm:p-6 sm:pb-3">
        <CardHeader eyebrow={tr('reports.last12Months')} title={tr('common.incomeVsExpenses')} />
      </div>
      <MonthlyComparisonChart rows={data} />
      <ScrollRegion label={tr('scroll.incomeVsExpenses')} className="border-t border-line-faint">
        <table className="w-full min-w-[560px] text-left">
          <thead>
            <tr className="border-b border-line bg-sunken/60">
              <th scope="col" className="label-eyebrow px-5 py-2.5 sm:px-6">{tr('common.month')}</th>
              <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{tr('common.income')}</th>
              <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{tr('common.expenses')}</th>
              <th scope="col" className="label-eyebrow px-5 py-2.5 text-right sm:px-6">{tr('common.net')}</th>
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
      </ScrollRegion>
    </Card>
  );
}

function BorrowLendTab() {
  const tr = useT();
  const { data = [], isLoading, isError, error, refetch } = useBorrowLendReport();

  if (isLoading) return <Card><LoadingState rows={4} /></Card>;
  if (isError) return <Card><ErrorState error={error} onRetry={() => void refetch()} /></Card>;
  if (data.length === 0) {
    return (
      <Card>
        <EmptyState icon={<FileBarChart className="size-5" />} title={tr('reports.noLendingActivity')} description={tr('reports.lendBorrowAndRepaymentHistoryWith')} />
      </Card>
    );
  }

  return (
    <Card bare>
<ScrollRegion label={tr('scroll.lendBorrow')}>
        <table className="w-full min-w-[640px] text-left">
          <thead>
            <tr className="border-b border-line bg-sunken/60">
              <th scope="col" className="label-eyebrow px-5 py-2.5 sm:px-6">{tr('common.person')}</th>
              <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{tr('quickAdd.type.lend.label')}</th>
              <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{tr('quickAdd.type.borrow.label')}</th>
              <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{tr('reports.repaidToYou')}</th>
              <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{tr('reports.repaidByYou')}</th>
              <th scope="col" className="label-eyebrow px-5 py-2.5 text-right sm:px-6">{tr('common.outstanding')}</th>
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
      </ScrollRegion>
    </Card>
  );
}

/** Revenue, expense and net profit (§Phase 12) — composed from the same category statement every other report reads, never a parallel aggregation. */
function ProfitAndLossTab() {
  const tr = useT();
  const [range, setRange] = useState<'this_month' | 'last_month' | 'this_year'>('this_month');
  const { data, isLoading, isError, error, refetch } = useProfitAndLoss(range);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex rounded-md border border-line bg-surface p-0.5">
        {(['this_month', 'last_month', 'this_year'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setRange(option)}
            aria-pressed={range === option}
            className={cn(
              'rounded-sm px-3.5 py-1.5 text-[12.5px] font-medium capitalize transition-colors',
              range === option ? 'bg-ink text-ink-inverse' : 'text-ink-muted hover:bg-sunken',
            )}
          >
            {option.replace('_', ' ')}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Card><LoadingState rows={5} /></Card>
      ) : isError ? (
        <Card><ErrorState error={error} onRetry={() => void refetch()} /></Card>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label={tr('reports.revenue')} amountMinor={data.income.totalMinor} tone="positive" />
            <StatCard label={tr('common.expenses')} amountMinor={data.expense.totalMinor} tone="negative" />
            <StatCard label={tr('reports.netProfit')} amountMinor={data.netProfitMinor} tone={data.netProfitMinor >= 0 ? 'positive' : 'negative'} />
          </div>

          <AnnualCategoryList title={tr('reports.revenueByCategory')} rows={data.income.rows.map((r) => ({ categoryId: r.categoryId, name: r.categoryName, icon: 'Circle', color: '#A8813C', amountMinor: r.amountMinor, percentOfTotal: data.income.totalMinor ? (r.amountMinor / data.income.totalMinor) * 100 : 0 }))} />
          <AnnualCategoryList title={tr('reports.expensesByCategory')} rows={data.expense.rows.map((r) => ({ categoryId: r.categoryId, name: r.categoryName, icon: 'Circle', color: '#A8813C', amountMinor: r.amountMinor, percentOfTotal: data.expense.totalMinor ? (r.amountMinor / data.expense.totalMinor) * 100 : 0 }))} />
        </>
      ) : null}
    </div>
  );
}

/** Receivables/payables aged by days past due (§Phase 12) — unpaid invoices and outstanding loans, side by side. */
function AgeingTab() {
  const tr = useT();
  const [direction, setDirection] = useState<'receivable' | 'payable'>('receivable');
  const { data, isLoading, isError, error, refetch } = useAgeingReport(direction);

  const bucketLabels: Record<string, string> = { not_due: tr('reports.notYetDue'), '0_30': tr('reports.days0to30'), '31_60': tr('reports.days31to60'), '61_90': tr('reports.days61to90'), over_90: tr('reports.daysOver90') };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex rounded-md border border-line bg-surface p-0.5">
        {(['receivable', 'payable'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setDirection(option)}
            aria-pressed={direction === option}
            className={cn(
              'rounded-sm px-3.5 py-1.5 text-[12.5px] font-medium capitalize transition-colors',
              direction === option ? 'bg-ink text-ink-inverse' : 'text-ink-muted hover:bg-sunken',
            )}
          >
            {option === 'receivable' ? tr('dashboard.receivables') : tr('dashboard.payables')}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Card><LoadingState rows={5} /></Card>
      ) : isError ? (
        <Card><ErrorState error={error} onRetry={() => void refetch()} /></Card>
      ) : !data || data.rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileBarChart className="size-5" />}
            title={direction === 'receivable' ? tr('reports.nothingOutstanding') : tr('reports.nothingOwed')}
            description={tr('reports.unpaidInvoicesAndOutstandingLoansPast')}
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(['not_due', '0_30', '31_60', '61_90', 'over_90'] as const).map((bucket) => (
              <div key={bucket} className="rounded-lg border border-line bg-surface px-3 py-3 shadow-xs">
                <p className="label-eyebrow">{bucketLabels[bucket]}</p>
                <div className="mt-1.5">
                  <Money amountMinor={data.totalsByBucket[bucket]} size="md" tone={bucket === 'over_90' || bucket === '61_90' ? 'negative' : 'neutral'} compactDecimals />
                </div>
              </div>
            ))}
          </div>

          <Card bare>
            <ul className="divide-y divide-line-faint">
              {data.rows.map((row) => (
                <li key={`${row.source}-${row.referenceId}`} className="flex items-center justify-between gap-3 px-5 py-3.5 sm:px-6">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium text-ink">{row.personName}</span>
                    <span className="mt-0.5 block text-[11.5px] text-ink-muted">
                      {row.referenceLabel} · {bucketLabels[row.bucket]}
                    </span>
                  </span>
                  <Money amountMinor={row.amountMinor} size="sm" tone={row.daysPastDue > 60 ? 'negative' : 'neutral'} />
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

/** GST collected, by rate — a summary to hand to an accountant, never a filing. */
function GstSummaryTab() {
  const tr = useT();
  const [range, setRange] = useState<'this_month' | 'last_month' | 'this_year'>('this_month');
  const { data, isLoading, isError, error, refetch } = useGstSummary(range);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex rounded-md border border-line bg-surface p-0.5">
          {(['this_month', 'last_month', 'this_year'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRange(option)}
              aria-pressed={range === option}
              className={cn(
                'rounded-sm px-3.5 py-1.5 text-[12.5px] font-medium capitalize transition-colors',
                range === option ? 'bg-ink text-ink-inverse' : 'text-ink-muted hover:bg-sunken',
              )}
            >
              {option.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <Card><LoadingState rows={5} /></Card>
      ) : isError ? (
        <Card><ErrorState error={error} onRetry={() => void refetch()} /></Card>
      ) : !data || data.rows.length === 0 ? (
        <Card>
          <EmptyState icon={<FileBarChart className="size-5" />} title={tr('reports.noGstCollected')} description={tr('reports.issuedInvoicesSentOverdueOrPaid')} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="CGST" amountMinor={data.totalCgstMinor} tone="neutral" />
            <StatCard label="SGST" amountMinor={data.totalSgstMinor} tone="neutral" />
            <StatCard label="IGST" amountMinor={data.totalIgstMinor} tone="neutral" />
          </div>

          <Card bare>
<ScrollRegion label={tr('reports.tabGstSummary')}>
              <table className="w-full min-w-[560px] text-left">
                <thead>
                  <tr className="border-b border-line bg-sunken/60">
                    <th scope="col" className="label-eyebrow px-5 py-2.5 sm:px-6">{tr('reports.rate')}</th>
                    <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{tr('reports.taxableValue')}</th>
                    <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">CGST</th>
                    <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">SGST</th>
                    <th scope="col" className="label-eyebrow px-5 py-2.5 text-right sm:px-6">IGST</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.taxPercent} className="border-b border-line-faint last:border-0 hover:bg-sunken/40">
                      <td className="px-5 py-3 text-[13px] font-medium text-ink sm:px-6">{row.taxPercent}%</td>
                      <td className="px-3 py-3 text-right"><Money amountMinor={row.taxableMinor} size="sm" compactDecimals /></td>
                      <td className="px-3 py-3 text-right"><Money amountMinor={row.cgstMinor} size="sm" compactDecimals /></td>
                      <td className="px-3 py-3 text-right"><Money amountMinor={row.sgstMinor} size="sm" compactDecimals /></td>
                      <td className="px-5 py-3 text-right sm:px-6"><Money amountMinor={row.igstMinor} size="sm" compactDecimals /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </Card>
        </>
      )}
    </div>
  );
}
