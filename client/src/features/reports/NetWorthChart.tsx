import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDate, formatMoney, formatMoneyCompact } from '@khata/shared';
import { useCurrency } from '../../hooks/useCurrency';
import { useChartColors } from '../../hooks/useChartColors';
import { useUiStore } from '../../stores/ui.store';

/**
 * Net worth over time (§31, §28).
 *
 * Form: a single-series area. One measure, one line — net worth either has a
 * value or it doesn't, so there's no second series to differentiate by colour.
 * A gold fill ties this to the same accent used for "important numbers"
 * elsewhere (net worth is the one figure the whole reports page adds up to).
 */
export function NetWorthChart({ history }: { history: Array<{ date: string; netWorthMinor: number }> }) {
  const currency = useCurrency();
  const privacyMode = useUiStore((s) => s.privacyMode);
  const colors = useChartColors();

  const data = history.map((point) => ({ ...point, value: point.netWorthMinor / 100 }));
  if (data.length === 0) return null;

  return (
    <div className="h-[220px] w-full px-2 pb-5 pt-3 sm:h-[260px] sm:px-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.accent} stopOpacity={0.22} />
              <stop offset="100%" stopColor={colors.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={colors.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(value: string) => formatDate(value, 'MMM')}
            tickLine={false}
            axisLine={{ stroke: colors.grid }}
            tick={{ fill: colors.axis, fontSize: 11 }}
            minTickGap={24}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tick={{ fill: colors.axis, fontSize: 11 }}
            tickFormatter={(value: number) => (privacyMode ? '•••' : formatMoneyCompact(Math.round(value * 100), currency))}
          />
          <Tooltip content={<NetWorthTooltip currency={currency} masked={privacyMode} />} cursor={{ stroke: colors.accent, strokeDasharray: '3 3' }} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={colors.accent}
            strokeWidth={2}
            fill="url(#netWorthFill)"
            dot={{ r: 3, fill: colors.accent, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: colors.accent, strokeWidth: 2, stroke: colors.surface }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function NetWorthTooltip({
  active,
  payload,
  currency,
  masked,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { date: string; netWorthMinor: number } }>;
  currency: string;
  masked: boolean;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="rounded-md border border-line bg-raised px-3 py-2.5 shadow-md">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
        {formatDate(point.date, 'MMM yyyy')}
      </p>
      <p className="tabular mt-1.5 text-[14px] font-semibold text-ink">
        {masked ? '••••' : formatMoney(point.netWorthMinor, { currency, compactDecimals: true })}
      </p>
    </div>
  );
}

