import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney, formatMoneyCompact, type CashFlowPointDto } from '@khata/shared';
import { useCurrency } from '../../hooks/useCurrency';
import { useChartColors } from '../../hooks/useChartColors';
import { useUiStore } from '../../stores/ui.store';
import { EmptyState } from '../../components/ui/States';
import { ChartLine } from 'lucide-react';

/**
 * Income vs expense over time.
 *
 * Form: grouped bars. The data's job is comparing two magnitudes within each
 * discrete period, which is exactly what paired bars do and what a line chart does
 * badly (a line implies continuity between buckets that monthly totals do not have).
 *
 * Colour: the series use the validated chart palette, *not* the green/red used for
 * the numbers. Green-vs-red measures ΔE 5.3 under deuteranopia — below even the
 * conditional floor — so a chart drawn in those colours is genuinely unreadable for
 * some people. See the note in `theme.css`. Identity is additionally carried by
 * position (income always left in each pair), by the legend, and by the tooltip, so
 * it never rests on colour alone.
 *
 * One y-axis only: both series are the same measure in the same currency, so there
 * is nothing a second scale could honestly represent.
 */
export function CashFlowChart({ points }: { points: CashFlowPointDto[] }) {
  const currency = useCurrency();
  const privacyMode = useUiStore((s) => s.privacyMode);
  const [showTable, setShowTable] = useState(false);

  const colors = useChartColors();

  const hasData = points.some((point) => point.incomeMinor > 0 || point.expenseMinor > 0);

  const data = useMemo(
    () =>
      points.map((point) => ({
        ...point,
        // Recharts works in numbers; keep the unit consistent and format on display.
        income: point.incomeMinor / 100,
        expense: point.expenseMinor / 100,
      })),
    [points],
  );

  if (!hasData) {
    return (
      <EmptyState
        compact
        icon={<ChartLine className="size-5" />}
        title="No activity in this period"
        description="Once you record income or expenses, your cash flow appears here."
      />
    );
  }

  return (
    <figure className="m-0 px-2 pb-4 pt-5 sm:px-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-3 sm:px-2">
        {/* Legend: always present for two or more series (§59 — identity is never
            colour alone). */}
        <ul className="flex items-center gap-4">
          {[
            { label: 'Income', color: colors.income },
            { label: 'Expenses', color: colors.expense },
          ].map((series) => (
            <li key={series.label} className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-2.5 rounded-[2px]"
                style={{ backgroundColor: series.color }}
              />
              <span className="text-[12px] font-medium text-ink-secondary">{series.label}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
          className="text-[12px] font-medium text-ink-muted underline-offset-4 transition-colors hover:text-gold hover:underline"
        >
          {showTable ? 'Hide table' : 'View as table'}
        </button>
      </div>

      <div className="h-[220px] w-full sm:h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2}>
            {/* Recessive grid: horizontal rules only, no vertical clutter. */}
            <CartesianGrid stroke={colors.grid} strokeDasharray="0" vertical={false} />

            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: colors.grid }}
              tick={{ fill: colors.axis, fontSize: 11 }}
              // Let Recharts drop labels rather than overlap them on a narrow screen.
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={56}
              tick={{ fill: colors.axis, fontSize: 11 }}
              tickFormatter={(value: number) =>
                privacyMode ? '•••' : formatMoneyCompact(Math.round(value * 100), currency)
              }
            />

            <Tooltip
              cursor={{ fill: colors.cursor }}
              content={<CashFlowTooltip currency={currency} masked={privacyMode} />}
            />

            {/* 4px rounded data-ends, anchored to the baseline. */}
            <Bar dataKey="income" name="Income" radius={[4, 4, 0, 0]} maxBarSize={22}>
              {data.map((point) => (
                <Cell key={`income-${point.bucket}`} fill={colors.income} />
              ))}
            </Bar>
            <Bar dataKey="expense" name="Expenses" radius={[4, 4, 0, 0]} maxBarSize={22}>
              {data.map((point) => (
                <Cell key={`expense-${point.bucket}`} fill={colors.expense} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/*
        The table view.
        Always in the DOM for screen readers; shown visually on request. A chart
        that only exists as pixels is not accessible, and this is also the fastest
        way for anyone to read an exact figure.
      */}
      <div className={showTable ? 'mt-4 overflow-x-auto' : 'sr-only'}>
        <table className="w-full min-w-[320px] text-left">
          <caption className="sr-only">Income and expenses by period</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="label-eyebrow py-2 pr-3 font-semibold">Period</th>
              <th scope="col" className="label-eyebrow py-2 px-3 text-right font-semibold">Income</th>
              <th scope="col" className="label-eyebrow py-2 px-3 text-right font-semibold">Expenses</th>
              <th scope="col" className="label-eyebrow py-2 pl-3 text-right font-semibold">Net</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.bucket} className="border-b border-line-faint last:border-0">
                <th scope="row" className="py-2 pr-3 text-[12.5px] font-medium text-ink-secondary">
                  {point.label}
                </th>
                <td className="sensitive py-2 px-3 text-right text-[12.5px] text-ink">
                  {formatMoney(point.incomeMinor, { currency, compactDecimals: true })}
                </td>
                <td className="sensitive py-2 px-3 text-right text-[12.5px] text-ink">
                  {formatMoney(point.expenseMinor, { currency, compactDecimals: true })}
                </td>
                <td
                  className={`sensitive py-2 pl-3 text-right text-[12.5px] font-medium ${
                    point.netMinor >= 0 ? 'text-positive' : 'text-negative'
                  }`}
                >
                  {formatMoney(point.netMinor, { currency, compactDecimals: true, signed: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

interface TooltipPayloadItem {
  dataKey?: string | number;
  payload?: CashFlowPointDto;
}

function CashFlowTooltip({
  active,
  payload,
  currency,
  masked,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  currency: string;
  masked: boolean;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  const money = (value: number) =>
    masked ? '••••' : formatMoney(value, { currency, compactDecimals: true });

  return (
    <div className="rounded-md border border-line bg-raised px-3 py-2.5 shadow-md">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
        {point.label}
      </p>
      <dl className="mt-2 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-6">
          <dt className="text-[12px] text-ink-secondary">Income</dt>
          <dd className="tabular text-[12.5px] font-semibold text-ink">{money(point.incomeMinor)}</dd>
        </div>
        <div className="flex items-center justify-between gap-6">
          <dt className="text-[12px] text-ink-secondary">Expenses</dt>
          <dd className="tabular text-[12.5px] font-semibold text-ink">{money(point.expenseMinor)}</dd>
        </div>
        <div className="flex items-center justify-between gap-6 border-t border-line-faint pt-1.5">
          <dt className="text-[12px] text-ink-secondary">Net</dt>
          <dd
            className={`tabular text-[12.5px] font-semibold ${
              point.netMinor >= 0 ? 'text-positive' : 'text-negative'
            }`}
          >
            {masked ? '••••' : formatMoney(point.netMinor, { currency, compactDecimals: true, signed: true })}
          </dd>
        </div>
      </dl>
    </div>
  );
}

