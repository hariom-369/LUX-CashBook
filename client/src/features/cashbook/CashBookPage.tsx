import { useMemo, useState } from 'react';
import { BookOpen, FileDown } from 'lucide-react';
import { RANGE_PRESET_LABELS, formatDate, resolveRange, type RangePreset } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useCashBook } from '../../lib/queries';
import { downloadFile } from '../../lib/download';
import { errorMessage } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';

type ViewMode = 'single' | 'double' | 'triple';

const VIEW_LABELS: Record<ViewMode, string> = {
  single: 'Single column',
  double: 'Cash & bank',
  triple: 'With discount',
};

const RANGE_OPTIONS: RangePreset[] = ['this_month', 'last_month', 'last_3_months', 'this_year'];

/**
 * The traditional cash book (§10).
 *
 * Three presentations of the same ledger, switchable without reloading the page:
 * a single receipt/payment column for a simple record, cash-and-bank side by side
 * for anyone who separates a drawer from a bank balance, and a discount column for
 * businesses that track discount allowed and received. A cash-to-bank transfer
 * shows on both sides as a "Contra" row rather than as income or an expense (§11).
 */
export function CashBookPage() {
  const [view, setView] = useState<ViewMode>('double');
  const [range, setRange] = useState<RangePreset>('this_month');
  const [pdfBusy, setPdfBusy] = useState(false);
  const accountingView = useAuthStore((s) => s.user?.preferences.accountingView ?? false);
  const toast = useToast();

  const dateRange = useMemo(() => resolveRange(range), [range]);
  const { data, isLoading, isError, error, refetch } = useCashBook({
    view,
    from: dateRange.from.toISOString(),
    to: dateRange.to.toISOString(),
  });

  async function exportPdf() {
    setPdfBusy(true);
    try {
      await downloadFile('/pdf/cash-book', { view, from: dateRange.from.toISOString(), to: dateRange.to.toISOString() });
    } catch (err) {
      toast.error('Could not generate the PDF', errorMessage(err));
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">Cash Book</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {formatDate(dateRange.from)} – {formatDate(dateRange.to)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Select value={range} onChange={(event) => setRange(event.target.value as RangePreset)} className="w-auto">
            {RANGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {RANGE_PRESET_LABELS[option]}
              </option>
            ))}
          </Select>

          <div className="flex rounded-md border border-line bg-surface p-0.5">
            {(Object.keys(VIEW_LABELS) as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                aria-pressed={view === mode}
                className={cn(
                  'rounded-sm px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                  view === mode ? 'bg-ink text-ink-inverse' : 'text-ink-muted hover:bg-sunken',
                )}
              >
                {VIEW_LABELS[mode]}
              </button>
            ))}
          </div>

          <Button variant="secondary" size="sm" leftIcon={<FileDown className="size-3.5" />} loading={pdfBusy} onClick={() => void exportPdf()}>
            PDF
          </Button>
        </div>
      </header>

      {isLoading ? (
        <Card>
          <LoadingState rows={6} />
        </Card>
      ) : isError ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : !data || data.rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BookOpen className="size-5" />}
            title="Nothing in this period"
            description="Once you record cash or bank transactions, they appear here in the traditional receipts-and-payments format."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <BalanceTile label={accountingView ? 'Balance b/d' : 'Opening balance'} amountMinor={data.opening.totalMinor} />
            <TotalsTile totals={data.totals} accountingView={accountingView} />
            <BalanceTile label={accountingView ? 'Balance c/d' : 'Closing balance'} amountMinor={data.closing.totalMinor} emphasise />
          </div>

          <Card bare>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left">
                <caption className="sr-only">Cash book, {VIEW_LABELS[view].toLowerCase()} view</caption>
                <thead>
                  <tr className="border-b border-line bg-sunken/60">
                    <th scope="col" className="label-eyebrow px-4 py-2.5">Date</th>
                    <th scope="col" className="label-eyebrow px-3 py-2.5">Particulars</th>
                    <th scope="col" className="label-eyebrow px-3 py-2.5">Ref</th>

                    {view === 'single' && (
                      <>
                        <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">Receipt</th>
                        <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">Payment</th>
                      </>
                    )}

                    {(view === 'double' || view === 'triple') && (
                      <>
                        <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">Cash In</th>
                        <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">Cash Out</th>
                        <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">Bank In</th>
                        <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">Bank Out</th>
                      </>
                    )}

                    {view === 'triple' && (
                      <>
                        <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">Disc. Allowed</th>
                        <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">Disc. Received</th>
                      </>
                    )}

                    <th scope="col" className="label-eyebrow px-4 py-2.5 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line-faint bg-sunken/30">
                    <td className="px-4 py-2 text-[12px] text-ink-muted" colSpan={view === 'triple' ? 9 : view === 'double' ? 7 : 5}>
                      {accountingView ? 'Balance b/d' : 'Opening balance'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Money amountMinor={data.opening.totalMinor} size="sm" tone="neutral" weight="medium" compactDecimals />
                    </td>
                  </tr>

                  {data.rows.map((row) => (
                    <tr key={row.id} className="border-b border-line-faint last:border-0 hover:bg-sunken/40">
                      <td className="whitespace-nowrap px-4 py-2.5 text-[12px] text-ink-muted">
                        {formatDate(row.date, 'dd MMM')}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13px] text-ink">{row.particulars}</span>
                          {row.isContra && (
                            <Badge tone="neutral" eyebrow className="shrink-0">
                              Contra
                            </Badge>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-[11.5px] text-ink-muted">{row.referenceNo ?? '—'}</td>

                      {view === 'single' && (
                        <>
                          <Cell amountMinor={row.receiptMinor} tone="positive" />
                          <Cell amountMinor={row.paymentMinor} tone="negative" />
                        </>
                      )}

                      {(view === 'double' || view === 'triple') && (
                        <>
                          <Cell amountMinor={row.cashReceiptMinor} tone="positive" />
                          <Cell amountMinor={row.cashPaymentMinor} tone="negative" />
                          <Cell amountMinor={row.bankReceiptMinor} tone="positive" />
                          <Cell amountMinor={row.bankPaymentMinor} tone="negative" />
                        </>
                      )}

                      {view === 'triple' && (
                        <>
                          <Cell amountMinor={row.discountAllowedMinor} tone="neutral" />
                          <Cell amountMinor={row.discountReceivedMinor} tone="neutral" />
                        </>
                      )}

                      <td className="px-4 py-2.5 text-right">
                        <Money
                          amountMinor={row.balanceMinor}
                          size="sm"
                          tone={row.balanceMinor < 0 ? 'negative' : 'neutral'}
                          weight="medium"
                          compactDecimals
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line-strong bg-sunken/60">
                    <td className="px-4 py-3 text-[12.5px] font-semibold text-ink" colSpan={3}>
                      {accountingView ? 'Balance c/d' : 'Closing balance'}
                    </td>

                    {view === 'single' && (
                      <>
                        <Cell amountMinor={data.totals.receiptMinor} tone="positive" bold />
                        <Cell amountMinor={data.totals.paymentMinor} tone="negative" bold />
                      </>
                    )}

                    {(view === 'double' || view === 'triple') && (
                      <>
                        <Cell amountMinor={data.totals.cashReceiptMinor} tone="positive" bold />
                        <Cell amountMinor={data.totals.cashPaymentMinor} tone="negative" bold />
                        <Cell amountMinor={data.totals.bankReceiptMinor} tone="positive" bold />
                        <Cell amountMinor={data.totals.bankPaymentMinor} tone="negative" bold />
                      </>
                    )}

                    {view === 'triple' && (
                      <>
                        <Cell amountMinor={data.totals.discountAllowedMinor} tone="neutral" bold />
                        <Cell amountMinor={data.totals.discountReceivedMinor} tone="neutral" bold />
                      </>
                    )}

                    <td className="px-4 py-3 text-right">
                      <Money amountMinor={data.closing.totalMinor} size="md" tone="neutral" compactDecimals />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Cell({
  amountMinor,
  tone,
  bold,
}: {
  amountMinor: number;
  tone: 'positive' | 'negative' | 'neutral';
  bold?: boolean;
}) {
  if (!amountMinor) return <td className="px-3 py-2.5 text-right text-ink-faint">—</td>;
  return (
    <td className="px-3 py-2.5 text-right">
      <Money amountMinor={amountMinor} size="sm" tone={tone} weight={bold ? 'semibold' : 'normal'} compactDecimals />
    </td>
  );
}

function BalanceTile({
  label,
  amountMinor,
  emphasise,
}: {
  label: string;
  amountMinor: number;
  emphasise?: boolean;
}) {
  return (
    <div className={cn('rounded-lg border bg-surface px-4 py-3.5 shadow-xs', emphasise ? 'border-gold/40' : 'border-line')}>
      <p className="label-eyebrow">{label}</p>
      <div className="mt-1.5">
        <Money amountMinor={amountMinor} size={emphasise ? 'lg' : 'md'} tone="neutral" compactDecimals />
      </div>
    </div>
  );
}

function TotalsTile({
  totals,
  accountingView,
}: {
  totals: { receiptMinor: number; paymentMinor: number };
  accountingView: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3.5 shadow-xs">
      <p className="label-eyebrow">This period</p>
      <div className="mt-2 flex items-center gap-4">
        <div>
          <p className="text-[11px] text-ink-muted">{accountingView ? 'Debit' : 'Receipts'}</p>
          <Money amountMinor={totals.receiptMinor} size="sm" tone="positive" weight="medium" compactDecimals />
        </div>
        <div>
          <p className="text-[11px] text-ink-muted">{accountingView ? 'Credit' : 'Payments'}</p>
          <Money amountMinor={totals.paymentMinor} size="sm" tone="negative" weight="medium" compactDecimals />
        </div>
      </div>
    </div>
  );
}
