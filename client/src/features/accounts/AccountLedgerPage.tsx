import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileDown, RefreshCw, Wallet } from 'lucide-react';
import {
  RANGE_PRESET_LABELS,
  TRANSACTION_META,
  formatDate,
  resolveRange,
  type RangePreset,
} from '@khata/shared';
import { cn } from '../../lib/cn';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { Icon } from '../../components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useAccountLedger, useInvalidateLedger } from '../../lib/queries';
import { api, errorMessage } from '../../lib/api';
import { downloadFile } from '../../lib/download';
import { useAuthStore } from '../../stores/auth.store';

const RANGE_OPTIONS: RangePreset[] = [
  'this_month', 'last_month', 'last_30_days', 'last_3_months', 'this_year', 'all_time',
];

/**
 * One account's ledger with a running balance (§52).
 *
 * Laid out as a statement: opening balance at the top, every movement in order, and
 * a running balance in the right-hand column that ends at the account's current
 * balance. Anyone can check the arithmetic by reading down the page, which is
 * exactly the promise §72 makes.
 */
export function AccountLedgerPage() {
  const { id } = useParams<{ id: string }>();
  const [range, setRange] = useState<RangePreset>('this_month');
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const toast = useToast();
  const invalidate = useInvalidateLedger();
  const accountingView = useAuthStore((s) => s.user?.preferences.accountingView ?? false);

  const dateRange = useMemo(() => resolveRange(range), [range]);
  const params = useMemo(
    () =>
      range === 'all_time'
        ? { limit: 500 }
        : { from: dateRange.from.toISOString(), to: dateRange.to.toISOString(), limit: 500 },
    [range, dateRange],
  );

  const { data, isLoading, isError, error, refetch } = useAccountLedger(id, params);

  /**
   * Rebuild the balance from the transactions (§72).
   *
   * This is the user-facing proof that the displayed figure is derived, not stored.
   */
  async function recompute() {
    if (!id) return;
    setBusy(true);
    try {
      const result = await api.post<{ balanceMinor: number; changed: boolean }>(
        `/accounts/${id}/recompute`,
      );
      invalidate();
      toast.success(
        result.changed ? 'Balance corrected' : 'Balance verified',
        result.changed
          ? 'The stored balance disagreed with the transactions and has been rebuilt from them.'
          : 'The balance matches the sum of every transaction on this account.',
      );
    } catch (err) {
      toast.error('Could not verify the balance', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function exportPdf() {
    if (!id) return;
    setPdfBusy(true);
    try {
      await downloadFile(`/pdf/accounts/${id}`, range === 'all_time' ? {} : { from: dateRange.from.toISOString(), to: dateRange.to.toISOString() });
    } catch (err) {
      toast.error('Could not generate the PDF', errorMessage(err));
    } finally {
      setPdfBusy(false);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <LoadingState rows={6} />
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Card>
    );
  }

  if (!data) return null;
  const { account, rows, openingBalanceMinor, closingBalanceMinor } = data;

  const totalIn = rows.filter((r) => r.amountMinor > 0).reduce((sum, r) => sum + r.amountMinor, 0);
  const totalOut = rows.filter((r) => r.amountMinor < 0).reduce((sum, r) => sum - r.amountMinor, 0);

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/accounts"
        className="flex w-fit items-center gap-1.5 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        All accounts
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex items-center gap-4">
            <span
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${account.color}1F`, color: account.color }}
            >
              <Icon name={account.icon} className="size-5" />
            </span>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold tracking-[-0.01em] text-ink">{account.name}</h1>
                {!account.isActive && <Badge tone="outline" eyebrow>Inactive</Badge>}
              </div>
              <p className="mt-0.5 text-[12.5px] text-ink-muted">
                {[account.bankName, account.last4 && `•••• ${account.last4}`].filter(Boolean).join(' · ') ||
                  'Current balance'}
              </p>
              <div className="mt-2">
                <Money
                  amountMinor={account.balanceMinor}
                  size="xl"
                  tone={account.balanceMinor < 0 ? 'negative' : 'neutral'}
                  compactDecimals
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={range}
              onChange={(event) => setRange(event.target.value as RangePreset)}
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
              variant="secondary"
              leftIcon={<RefreshCw className="size-3.5" />}
              loading={busy}
              onClick={() => void recompute()}
              title="Recalculate this balance from every transaction on the account"
            >
              Verify balance
            </Button>

            <Button variant="secondary" leftIcon={<FileDown className="size-3.5" />} loading={pdfBusy} onClick={() => void exportPdf()}>
              PDF statement
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatementTile label={accountingView ? 'Balance b/d' : 'Opening'} amountMinor={openingBalanceMinor} />
        <StatementTile label={accountingView ? 'Debit' : 'Money in'} amountMinor={totalIn} tone="positive" />
        <StatementTile label={accountingView ? 'Credit' : 'Money out'} amountMinor={totalOut} tone="negative" />
        <StatementTile
          label={accountingView ? 'Balance c/d' : 'Closing'}
          amountMinor={closingBalanceMinor}
          emphasise
        />
      </div>

      <Card bare>
        <div className="p-5 pb-3 sm:p-6 sm:pb-3">
          <CardHeader
            eyebrow="Statement"
            title={
              range === 'all_time'
                ? 'All transactions'
                : `${formatDate(dateRange.from)} – ${formatDate(dateRange.to)}`
            }
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Wallet className="size-5" />}
            title="Nothing in this period"
            description="Try a wider date range, or record a transaction against this account."
          />
        ) : (
          <div className="overflow-x-auto border-t border-line-faint">
            <table className="w-full min-w-[640px] text-left">
              <caption className="sr-only">
                Statement for {account.name}, showing a running balance
              </caption>
              <thead>
                <tr className="border-b border-line bg-sunken/60">
                  <th scope="col" className="label-eyebrow px-5 py-2.5 sm:px-6">Date</th>
                  <th scope="col" className="label-eyebrow px-3 py-2.5">Particulars</th>
                  <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">
                    {accountingView ? 'Debit' : 'In'}
                  </th>
                  <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">
                    {accountingView ? 'Credit' : 'Out'}
                  </th>
                  <th scope="col" className="label-eyebrow px-5 py-2.5 text-right sm:px-6">Balance</th>
                </tr>
              </thead>
              <tbody>
                {/* The opening row anchors the arithmetic that follows. */}
                <tr className="border-b border-line-faint bg-sunken/30">
                  <td className="px-5 py-2.5 text-[12px] text-ink-muted sm:px-6" colSpan={4}>
                    {accountingView ? 'Balance b/d' : 'Opening balance'}
                  </td>
                  <td className="px-5 py-2.5 text-right sm:px-6">
                    <Money amountMinor={openingBalanceMinor} size="sm" tone="neutral" weight="medium" compactDecimals />
                  </td>
                </tr>

                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-line-faint last:border-0 hover:bg-sunken/40">
                    <td className="whitespace-nowrap px-5 py-3 text-[12.5px] text-ink-muted sm:px-6">
                      {formatDate(row.date, 'dd MMM')}
                    </td>
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-ink">{row.description}</span>
                        {row.isContra && (
                          <Badge tone="neutral" eyebrow className="shrink-0">
                            Contra
                          </Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
                        {[
                          TRANSACTION_META[row.type as keyof typeof TRANSACTION_META]?.label,
                          row.counterAccountName,
                          row.categoryName,
                          row.personName,
                          row.referenceNo,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {row.amountMinor > 0 && (
                        <Money amountMinor={row.amountMinor} size="sm" tone="positive" compactDecimals />
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {row.amountMinor < 0 && (
                        <Money amountMinor={-row.amountMinor} size="sm" tone="negative" compactDecimals />
                      )}
                    </td>
                    <td className="px-5 py-3 text-right sm:px-6">
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
                  <td className="px-5 py-3 text-[12.5px] font-semibold text-ink sm:px-6" colSpan={2}>
                    {accountingView ? 'Balance c/d' : 'Closing balance'}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Money amountMinor={totalIn} size="sm" tone="positive" weight="medium" compactDecimals />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Money amountMinor={totalOut} size="sm" tone="negative" weight="medium" compactDecimals />
                  </td>
                  <td className="px-5 py-3 text-right sm:px-6">
                    <Money amountMinor={closingBalanceMinor} size="md" tone="neutral" compactDecimals />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function StatementTile({
  label,
  amountMinor,
  tone = 'neutral',
  emphasise,
}: {
  label: string;
  amountMinor: number;
  tone?: 'positive' | 'negative' | 'neutral';
  emphasise?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-surface px-4 py-3 shadow-xs',
        emphasise ? 'border-gold/40' : 'border-line',
      )}
    >
      <p className="label-eyebrow">{label}</p>
      <div className="mt-1.5">
        <Money amountMinor={amountMinor} size="md" tone={tone} compactDecimals />
      </div>
    </div>
  );
}
