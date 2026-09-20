import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, formatMoneyCompact } from '@khata/shared';
import { useCurrency } from '../../hooks/useCurrency';
import { useChartColors } from '../../hooks/useChartColors';
import { useUiStore } from '../../stores/ui.store';
import type { MonthSummaryRow } from '../../lib/reportTypes';

/**
 * Twelve months of income vs expense, grouped bars.
 *
 * The same form and the same validated palette as the dashboard's cash-flow chart
 * (`CashFlowChart.tsx`) — one visual language for "income vs expense over time"
 * wherever it appears, rather than two charts that happen to show similar data
 * differently.
 */
export function MonthlyComparisonChart({ rows }: { rows: MonthSummaryRow[] }) {
  const currency = useCurrency();
  const privacyMode = useUiStore((s) => s.privacyMode);
  const colors = useChartColors();

  const data = rows.map((row) => ({ ...row, income: row.incomeMinor / 100, expense: row.expenseMinor / 100 }));

  return (
    <div className="h-[240px] w-full px-2 pb-4 pt-4 sm:h-[280px] sm:px-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke={colors.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: colors.grid }}
            tick={{ fill: colors.axis, fontSize: 11 }}
            interval="preserveStartEnd"
            minTickGap={20}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tick={{ fill: colors.axis, fontSize: 11 }}
            tickFormatter={(value: number) => (privacyMode ? '•••' : formatMoneyCompact(Math.round(value * 100), currency))}
          />
          <Tooltip cursor={{ fill: colors.cursor }} content={<MonthTooltip currency={currency} masked={privacyMode} />} />
          <Bar dataKey="income" name="Income" radius={[4, 4, 0, 0]} maxBarSize={18}>
            {data.map((row) => (
              <Cell key={`income-${row.year}-${row.month}`} fill={colors.income} />
            ))}
          </Bar>
          <Bar dataKey="expense" name="Expenses" radius={[4, 4, 0, 0]} maxBarSize={18}>
            {data.map((row) => (
              <Cell key={`expense-${row.year}-${row.month}`} fill={colors.expense} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MonthTooltip({
  active,
  payload,
  currency,
  masked,
}: {
  active?: boolean;
  payload?: Array<{ payload?: MonthSummaryRow }>;
  currency: string;
  masked: boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const money = (value: number) => (masked ? '••••' : formatMoney(value, { currency, compactDecimals: true }));

  return (
    <div className="rounded-md border border-line bg-raised px-3 py-2.5 shadow-md">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{row.label}</p>
      <dl className="mt-2 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-6">
          <dt className="text-[12px] text-ink-secondary">Income</dt>
          <dd className="tabular text-[12.5px] font-semibold text-ink">{money(row.incomeMinor)}</dd>
        </div>
        <div className="flex items-center justify-between gap-6">
          <dt className="text-[12px] text-ink-secondary">Expenses</dt>
          <dd className="tabular text-[12.5px] font-semibold text-ink">{money(row.expenseMinor)}</dd>
        </div>
      </dl>
    </div>
  );
}
