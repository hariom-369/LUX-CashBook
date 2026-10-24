import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { monthLabel, type MonthlyChangeDto } from '@khata/shared';
import { Card, CardHeader } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Money } from '../../components/ui/Money';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useMonthlyInsights } from '../../lib/queries5';
import { cn } from '../../lib/cn';
import { useT } from '../../i18n';

const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const label = (key: string) => monthLabel(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, true);
const shift = (key: string, by: number) => keyOf(new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1 + by, 1));

/**
 * Monthly summary (Insights): one month's recorded income, spending and savings, where the money
 * went, and how that compares with the month before. Every figure is a fact from the server; the
 * one estimate (the month-end projection) is labelled as such. A month still in progress is
 * compared with the same number of days of the previous month, never the whole of it.
 */
export function MonthlySummary() {
  const t = useT();
  const thisMonth = keyOf(new Date());
  const [month, setMonth] = useState(thisMonth);
  const { data, isLoading, isError, error, refetch, isFetching } = useMonthlyInsights(month);

  // Nothing recorded in the comparison period: show no comparison rather than "₹0" everywhere.
  const canCompare = Boolean(data?.comparison.hasData);
  const compareLabel = data
    ? data.comparisonBasis === 'previous_month_to_date'
      ? t('insights.monthly.vsSameDays', { month: label(data.comparison.month) })
      : t('insights.monthly.vsMonth', { month: label(data.comparison.month) })
    : '';

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <CardHeader eyebrow={t('insights.monthly.eyebrow')} title={label(month)} />
        <div className="flex items-center gap-1">
          <NavButton label={t('insights.monthly.previousMonth')} onClick={() => setMonth((m) => shift(m, -1))}>
            <ChevronLeft aria-hidden className="size-4" />
          </NavButton>
          <input
            type="month"
            value={month}
            max={thisMonth}
            onChange={(e) => e.target.value && e.target.value <= thisMonth && setMonth(e.target.value)}
            aria-label={t('insights.monthly.chooseMonth')}
            className="h-9 rounded-md border border-line bg-sunken px-2.5 text-[13px] text-ink focus:border-gold focus:outline-none"
          />
          <NavButton label={t('insights.monthly.nextMonth')} disabled={month >= thisMonth} onClick={() => setMonth((m) => shift(m, 1))}>
            <ChevronRight aria-hidden className="size-4" />
          </NavButton>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-4"><LoadingState rows={4} /></div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data ? null : !data.hasData && !data.comparison.hasData ? (
        <EmptyState title={t('insights.monthly.nothingRecorded', { month: label(month) })} description={t('insights.monthly.nothingRecordedHint')} />
      ) : (
        <div className={cn('mt-4 flex flex-col gap-5', isFetching && 'opacity-70 transition-opacity')}>
          {data.isPartial && (
            <p className="flex items-center gap-2 text-[12px] text-ink-muted">
              <Badge tone="gold" eyebrow>{t('insights.monthly.inProgress')}</Badge>
              {t('insights.monthly.upToToday', { day: data.daysElapsed, days: data.daysInMonth })}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Figure label={t('insights.monthly.income')} amount={data.incomeMinor} previous={canCompare ? data.comparison.incomeMinor : null} compareLabel={compareLabel}>
              {data.refundsMinor > 0 && (
                <span className="block text-[11px] text-ink-muted">
                  {t('insights.monthly.includesRefunds')} <Money amountMinor={data.refundsMinor} size="xs" tone="inherit" compactDecimals />
                </span>
              )}
            </Figure>
            <Figure label={t('insights.monthly.spending')} amount={data.expenseMinor} previous={canCompare ? data.comparison.expenseMinor : null} compareLabel={compareLabel} />
            <Figure label={t('insights.monthly.saved')} amount={data.netSavingsMinor} previous={canCompare ? data.comparison.netSavingsMinor : null} compareLabel={compareLabel} signed>
              {data.savingsRatePercent !== null && (
                <span className="block text-[11px] text-ink-muted">{t('insights.monthly.ofIncome', { percent: data.savingsRatePercent })}</span>
              )}
            </Figure>
          </div>

          {!canCompare && (
            <p className="text-[12px] text-ink-muted">{t('insights.monthly.nothingToCompare', { month: label(data.comparison.month) })}</p>
          )}

          {data.significantChanges.length > 0 && (
            <section>
              <h3 className="label-eyebrow mb-2">{t('insights.monthly.whatChanged')}</h3>
              <ul className="flex flex-col gap-1.5">
                {data.significantChanges.map((c, i) => (
                  <li key={`${c.kind}-${c.categoryId ?? i}`} className="sensitive text-[13px] leading-relaxed text-ink-secondary">
                    <ChangeLine change={c} compareLabel={compareLabel} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.categories.length > 0 && (
            <section>
              <h3 className="label-eyebrow mb-2">{t('insights.monthly.whereItWent')}</h3>
              <ul className="flex flex-col gap-2.5">
                {data.categories.slice(0, 8).map((c) => (
                  <li key={c.categoryId ?? 'none'}>
                    <div className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="min-w-0 truncate text-ink">{c.categoryId ? c.name : t('common.uncategorised')}</span>
                      <span className="flex shrink-0 items-baseline gap-2">
                        <Money amountMinor={c.amountMinor} size="sm" tone="neutral" compactDecimals />
                        <span className="w-12 text-right text-[11px] text-ink-faint tabular">{c.sharePercent}%</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
                      <div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(100, c.sharePercent)}%` }} />
                    </div>
                    {canCompare && (
                      <p className="mt-0.5 text-[11px] text-ink-faint">
                        {compareLabel}: <Money amountMinor={c.comparisonMinor} size="xs" tone="inherit" compactDecimals />
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(data.upcoming || data.projection) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {data.upcoming && (
                <Link to="/upcoming" className="rounded-lg border border-line bg-surface px-4 py-3 transition-colors hover:bg-sunken">
                  <p className="flex items-center gap-1.5 label-eyebrow">
                    <CalendarClock aria-hidden className="size-3.5" />
                    {t('insights.monthly.stillScheduled')}
                  </p>
                  {data.upcoming.count === 0 ? (
                    <p className="mt-1 text-[13px] text-ink-muted">{t('insights.monthly.nothingScheduled')}</p>
                  ) : (
                    <p className="sensitive mt-1 text-[13px] text-ink-secondary">
                      {t.plural('insights.monthly.scheduledCount', data.upcoming.count)} · {t('insights.monthly.goingOut')}{' '}
                      <Money amountMinor={data.upcoming.outMinor} size="sm" tone="negative" compactDecimals />
                      {data.upcoming.inMinor > 0 && (
                        <>
                          {' '}· {t('insights.monthly.comingIn')} <Money amountMinor={data.upcoming.inMinor} size="sm" tone="positive" compactDecimals />
                        </>
                      )}
                    </p>
                  )}
                </Link>
              )}
              {data.projection && (
                <div className="rounded-lg border border-dashed border-line bg-surface px-4 py-3">
                  <p className="flex items-center gap-2 label-eyebrow">
                    {t('insights.monthly.pace')} <Badge tone="outline">{t('insights.monthly.estimate')}</Badge>
                  </p>
                  <p className="sensitive mt-1 text-[13px] text-ink-secondary">
                    {t('insights.monthly.atThisPace')} <Money amountMinor={data.projection.expenseMinor} size="sm" tone="neutral" compactDecimals />
                  </p>
                </div>
              )}
            </div>
          )}

          <p className="flex gap-2 text-[11.5px] leading-relaxed text-ink-muted">
            <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span className="sensitive">
              {t('insights.monthly.notCounted')}{' '}
              {(data.notCounted.transfersMinor > 0 || data.notCounted.loansAndRepaymentsMinor > 0) && (
                <>
                  {t('insights.monthly.thisMonthTransfers')} <Money amountMinor={data.notCounted.transfersMinor} size="xs" tone="inherit" compactDecimals /> ·{' '}
                  {t('insights.monthly.thisMonthLoans')} <Money amountMinor={data.notCounted.loansAndRepaymentsMinor} size="xs" tone="inherit" compactDecimals />
                </>
              )}
            </span>
          </p>
        </div>
      )}
    </Card>
  );
}

function Figure({ label, amount, previous, compareLabel, signed, children }: { label: string; amount: number; previous: number | null; compareLabel: string; signed?: boolean; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3.5 shadow-xs">
      <p className="label-eyebrow">{label}</p>
      <div className="mt-1.5">
        <Money amountMinor={amount} size="md" tone={signed ? 'auto' : 'neutral'} compactDecimals />
      </div>
      {children}
      {previous !== null && (
        <span className="mt-1 block text-[11px] text-ink-faint">
          {compareLabel}: <Money amountMinor={previous} size="xs" tone="inherit" compactDecimals />
        </span>
      )}
    </div>
  );
}

function ChangeLine({ change, compareLabel }: { change: MonthlyChangeDto; compareLabel: string }) {
  const t = useT();
  const up = change.changeMinor > 0;
  const amount = <Money amountMinor={Math.abs(change.changeMinor)} size="sm" tone={change.kind === 'income' ? (up ? 'positive' : 'negative') : up ? 'negative' : 'positive'} compactDecimals />;
  const percent = change.changePercent !== null ? ` (${up ? '+' : ''}${change.changePercent}%)` : '';
  const what =
    change.kind === 'income'
      ? t(up ? 'insights.monthly.incomeUp' : 'insights.monthly.incomeDown')
      : change.kind === 'expense'
        ? t(up ? 'insights.monthly.spendingUp' : 'insights.monthly.spendingDown')
        : change.comparisonMinor === 0
          ? t('insights.monthly.newSpendingOn', { name: change.categoryId ? (change.name ?? '') : t('common.uncategorised') })
          : t(up ? 'insights.monthly.categoryUp' : 'insights.monthly.categoryDown', { name: change.categoryId ? (change.name ?? '') : t('common.uncategorised') });
  return (
    <>
      {what} {amount}
      {percent} <span className="text-ink-faint">· {compareLabel}</span>
    </>
  );
}

function NavButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-9 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-sunken disabled:opacity-40"
    >
      {children}
    </button>
  );
}
