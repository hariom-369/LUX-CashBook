import { useEffect, useMemo, useState } from 'react';
import { BookOpen, FileDown } from 'lucide-react';
import { PRIVATE_TRANSFER_LABEL, RANGE_PRESET_LABELS, formatDate, resolveRange, type RangePreset } from '@khata/shared';
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
import { useT, msg, type MessageRef } from '../../i18n';
import { ScrollRegion } from '../../components/ui/ScrollRegion';

type ViewMode = 'single' | 'double' | 'triple';

const VIEW_LABELS: Record<ViewMode, MessageRef> = {
  single: msg('cashbook.singleColumn'),
  double: msg('cashbook.cashBank'),
  triple: msg('cashbook.withDiscount'),
};

/**
 * Rows drawn at a time. Measured (§Phase 16): 5,000 rows is ~65,000 DOM nodes — about 2 s on a
 * desktop and ~15 s on a phone-class CPU, with half the scroll frames dropped — while a month
 * (~100 rows) is instant. Totals and balances come from the server over every row, so drawing
 * fewer rows changes nothing about the figures.
 */
export const CASH_BOOK_PAGE_SIZE = 250;

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
  const t = useT();
  const [view, setView] = useState<ViewMode>('double');
  const [range, setRange] = useState<RangePreset>('this_month');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [visible, setVisible] = useState(CASH_BOOK_PAGE_SIZE);
  const accountingView = useAuthStore((s) => s.user?.preferences.accountingView ?? false);
  const toast = useToast();

  const dateRange = useMemo(() => resolveRange(range), [range]);

  // A different period or view is a different list: start again from the first screenful.
  useEffect(() => setVisible(CASH_BOOK_PAGE_SIZE), [range, view]);
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
      toast.error(t('common.couldNotGenerateThePdf'), errorMessage(err));
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{t('nav.cash-book')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {formatDate(dateRange.from)} – {formatDate(dateRange.to)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Select aria-label={t('common.dateRange')} value={range} onChange={(event) => setRange(event.target.value as RangePreset)} className="w-auto">
            {RANGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t.label('range', option, RANGE_PRESET_LABELS[option])}
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
                {t(VIEW_LABELS[mode].key)}
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
            title={t('common.nothingInThisPeriod')}
            description={t('cashbook.onceYouRecordCashOrBank')}
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <BalanceTile label={accountingView ? t('common.balanceBD') : t('common.openingBalance')} amountMinor={data.opening.totalMinor} />
            <TotalsTile totals={data.totals} accountingView={accountingView} />
            <BalanceTile label={accountingView ? t('common.balanceCD') : t('common.closingBalance')} amountMinor={data.closing.totalMinor} emphasise />
          </div>

          <Card bare>
<ScrollRegion label={t('nav.cash-book')}>
              <table className="w-full min-w-[720px] text-left">
                <caption className="sr-only">{t('cashbook.cashBook')} {t(VIEW_LABELS[view].key).toLowerCase()} {t('cashbook.view')}</caption>
                <thead>
                  <tr className="border-b border-line bg-sunken/60">
                    <th scope="col" className="label-eyebrow px-4 py-2.5">{t('common.date')}</th>
                    <th scope="col" className="label-eyebrow px-3 py-2.5">{t('common.particulars')}</th>
                    <th scope="col" className="label-eyebrow px-3 py-2.5">{t('cashbook.ref')}</th>

                    {view === 'single' && (
                      <>
                        <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{t('common.receipt')}</th>
                        <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{t('cashbook.payment')}</th>
                      </>
                    )}

                    {(view === 'double' || view === 'triple') && (
                      <>
                        <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{t('cashbook.cashIn')}</th>
                        <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{t('cashbook.cashOut')}</th>
                        <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{t('cashbook.bankIn')}</th>
                        <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{t('cashbook.bankOut')}</th>
                      </>
                    )}

                    {view === 'triple' && (
                      <>
                        <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{t('cashbook.discAllowed')}</th>
                        <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{t('cashbook.discReceived')}</th>
                      </>
                    )}

                    <th scope="col" className="label-eyebrow px-4 py-2.5 text-right">{t('common.balance')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line-faint bg-sunken/30">
                    <td className="px-4 py-2 text-[12px] text-ink-muted" colSpan={view === 'triple' ? 9 : view === 'double' ? 7 : 5}>
                      {accountingView ? t('common.balanceBD') : t('common.openingBalance')}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Money amountMinor={data.opening.totalMinor} size="sm" tone="neutral" weight="medium" compactDecimals />
                    </td>
                  </tr>

                  {data.rows.slice(0, visible).map((row) => (
                    <tr key={row.id} className="border-b border-line-faint last:border-0 hover:bg-sunken/40">
                      <td className="whitespace-nowrap px-4 py-2.5 text-[12px] text-ink-muted">
                        {formatDate(row.date, 'dd MMM')}
                      </td>
                      {/* Below xl this column takes the leftover width (at least 10rem) and truncates,
                          so the table keeps its designed width instead of growing with the longest text. */}
                      <td className="px-3 py-2.5 max-xl:w-full max-xl:min-w-40 max-xl:max-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13px] text-ink">{row.particulars === PRIVATE_TRANSFER_LABEL ? t('transactions.privateTransfer') : row.particulars}</span>
                          {row.isContra && (
                            <Badge tone="neutral" eyebrow className="shrink-0">
                              {t('common.contra')}
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
                      {accountingView ? t('common.balanceCD') : t('common.closingBalance')}
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
            </ScrollRegion>

            {data.rows.length > visible && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-faint px-4 py-3">
                <p role="status" className="text-[12.5px] text-ink-muted">
                  {t('cashbook.showingCount', { shown: visible, total: data.rows.length })}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setVisible((v) => v + CASH_BOOK_PAGE_SIZE)}>
                    {t('cashbook.showMore', { count: Math.min(CASH_BOOK_PAGE_SIZE, data.rows.length - visible) })}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setVisible(data.rows.length)}>
                    {t('cashbook.showAll', { count: data.rows.length })}
                  </Button>
                </div>
              </div>
            )}
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
  const t = useT();
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3.5 shadow-xs">
      <p className="label-eyebrow">{t('cashbook.thisPeriod')}</p>
      <div className="mt-2 flex items-center gap-4">
        <div>
          <p className="text-[11px] text-ink-muted">{accountingView ? t('common.debit') : t('cashbook.receipts')}</p>
          <Money amountMinor={totals.receiptMinor} size="sm" tone="positive" weight="medium" compactDecimals />
        </div>
        <div>
          <p className="text-[11px] text-ink-muted">{accountingView ? t('common.credit') : t('cashbook.payments')}</p>
          <Money amountMinor={totals.paymentMinor} size="sm" tone="negative" weight="medium" compactDecimals />
        </div>
      </div>
    </div>
  );
}
