import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDate, formatMoney, formatMoneyCompact } from '@khata/shared';
import { useCurrency } from '../../hooks/useCurrency';
import { useChartColors } from '../../hooks/useChartColors';
import { useUiStore } from '../../stores/ui.store';
import { ChartTextAlternative } from '../../components/ui/ChartTextAlternative';
import { useT } from '../../i18n';

/**
 * Cash-flow forecast (§Phase 7) — a projection, never an actual balance, so
 * it gets its own chart rather than reusing `NetWorthChart` for something
 * that reads differently: every point here is an estimate from today
 * forward, not a historical fact.
 */
export function ForecastChart({ points }: { points: Array<{ date: string; projectedBalanceMinor: number }> }) {
  const t = useT();
  const currency = useCurrency();
  const privacyMode = useUiStore((s) => s.privacyMode);
  const colors = useChartColors();

  const data = points.map((point) => ({ ...point, value: point.projectedBalanceMinor / 100 }));
  if (data.length === 0) return null;

  return (
    <>
    {/* The picture is hidden from assistive tech; the table below carries the same points. */}
    <div aria-hidden className="h-[220px] w-full px-2 pb-5 pt-3 sm:h-[260px] sm:px-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.accent} stopOpacity={0.18} />
              <stop offset="100%" stopColor={colors.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={colors.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(value: string) => formatDate(value, 'dd MMM')}
            tickLine={false}
            axisLine={{ stroke: colors.grid }}
            tick={{ fill: colors.axis, fontSize: 11 }}
            minTickGap={32}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tick={{ fill: colors.axis, fontSize: 11 }}
            tickFormatter={(value: number) => (privacyMode ? '•••' : formatMoneyCompact(Math.round(value * 100), currency))}
          />
          <Tooltip content={<ForecastTooltip currency={currency} masked={privacyMode} />} cursor={{ stroke: colors.accent, strokeDasharray: '3 3' }} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={colors.accent}
            strokeWidth={2}
            strokeDasharray="4 3"
            fill="url(#forecastFill)"
            dot={false}
            activeDot={{ r: 4, fill: colors.accent, strokeWidth: 2, stroke: colors.surface }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
    <ChartTextAlternative
      caption={t('reports.cashFlowForecast')}
      columns={[t('common.date'), t('reports.projectedBalance')]}
      rows={points.map((point) => [
        formatDate(point.date),
        privacyMode ? '••••' : formatMoney(point.projectedBalanceMinor, { currency, compactDecimals: true }),
      ])}
    />
    </>
  );
}

function ForecastTooltip({
  active,
  payload,
  currency,
  masked,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { date: string; projectedBalanceMinor: number } }>;
  currency: string;
  masked: boolean;
}) {
  const t = useT();
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="rounded-md border border-line bg-raised px-3 py-2.5 shadow-md">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{formatDate(point.date)}</p>
      <p className="tabular mt-1.5 text-[14px] font-semibold text-ink">
        {masked ? '••••' : formatMoney(point.projectedBalanceMinor, { currency, compactDecimals: true })}
      </p>
      <p className="mt-0.5 text-[10.5px] text-ink-muted">{t('reports.estimated')}</p>
    </div>
  );
}
