import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileDown, RefreshCw, Scale, Upload, Wallet } from 'lucide-react';
import {
  PRIVATE_TRANSFER_LABEL,
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
import { useCardSummary } from '../../lib/queries3';
import { api, errorMessage } from '../../lib/api';
import { downloadFile } from '../../lib/download';
import { useAuthStore } from '../../stores/auth.store';
import { ImportWizard } from './ImportWizard';
import { ReconcileDialog } from './ReconcileDialog';
import { useT } from '../../i18n';
import { ScrollRegion } from '../../components/ui/ScrollRegion';

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
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const [range, setRange] = useState<RangePreset>('this_month');
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [reconciling, setReconciling] = useState(false);

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
        result.changed ? t('accounts.balanceCorrected') : t('accounts.balanceVerified'),
        result.changed
          ? t('accounts.theStoredBalanceDisagreedWithThe')
          : t('accounts.theBalanceMatchesTheSumOf'),
      );
    } catch (err) {
      toast.error(t('accounts.couldNotVerifyTheBalance'), errorMessage(err));
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
      toast.error(t('common.couldNotGenerateThePdf'), errorMessage(err));
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
        <ErrorState titleAs="h1" error={error} onRetry={() => void refetch()} />
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
        {t('common.allAccounts')}
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex min-w-0 items-center gap-4">
            <span
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${account.color}1F`, color: account.color }}
            >
              <Icon name={account.icon} className="size-5" />
            </span>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="min-w-0 break-words text-lg font-semibold tracking-[-0.01em] text-ink">{account.name}</h1>
                {!account.isActive && <Badge tone="outline" eyebrow>{t('accounts.inactive')}</Badge>}
              </div>
              <p className="mt-0.5 text-[12.5px] text-ink-muted">
                {[account.bankName, account.last4 && `•••• ${account.last4}`].filter(Boolean).join(' · ') ||
                  t('onboarding.currentBalance')}
              </p>
              <div className="mt-2">
                <Money
                  amountMinor={account.balanceMinor}
                  size="xl"
                  tone={account.balanceMinor < 0 ? 'negative' : 'neutral'}
                  compactDecimals
                  className="max-sm:text-[length:clamp(1.375rem,7.5vw,1.75rem)]"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={range}
              onChange={(event) => setRange(event.target.value as RangePreset)}
              aria-label={t('common.dateRange')}
              className="w-auto min-w-[150px]"
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t.label('range', option, RANGE_PRESET_LABELS[option])}
                </option>
              ))}
            </Select>

            <Button
              variant="secondary"
              leftIcon={<RefreshCw className="size-3.5" />}
              loading={busy}
              onClick={() => void recompute()}
              title={t('accounts.recalculateThisBalanceFromEveryTransacti')}
            >
              {t('accounts.verifyBalance')}
            </Button>

            <Button variant="secondary" leftIcon={<FileDown className="size-3.5" />} loading={pdfBusy} onClick={() => void exportPdf()}>
              {t('accounts.pdfStatement')}
            </Button>

            <Button variant="secondary" leftIcon={<Upload className="size-3.5" />} onClick={() => setImporting(true)}>
              {t('accounts.importStatement')}
            </Button>

            <Button variant="secondary" leftIcon={<Scale className="size-3.5" />} onClick={() => setReconciling(true)}>
              {t('accounts.reconcile')}
            </Button>
          </div>
        </div>
      </Card>

      {id && (
        <>
          <ImportWizard accountId={id} open={importing} onClose={() => setImporting(false)} />
          <ReconcileDialog accountId={id} accountName={account.name} open={reconciling} onClose={() => setReconciling(false)} />
        </>
      )}

      {id && account.type === 'credit_card' && <CreditCardSummary accountId={id} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <StatementTile label={accountingView ? t('common.balanceBD') : t('accounts.opening')} amountMinor={openingBalanceMinor} />
        <StatementTile label={accountingView ? t('common.debit') : t('common.moneyIn')} amountMinor={totalIn} tone="positive" />
        <StatementTile label={accountingView ? t('common.credit') : t('common.moneyOut')} amountMinor={totalOut} tone="negative" />
        <StatementTile
          label={accountingView ? t('common.balanceCD') : t('accounts.closing')}
          amountMinor={closingBalanceMinor}
          emphasise
        />
      </div>

      <Card bare>
        <div className="p-5 pb-3 sm:p-6 sm:pb-3">
          <CardHeader
            eyebrow={t('accounts.statement')}
            title={
              range === 'all_time'
                ? t('accounts.allTransactions')
                : `${formatDate(dateRange.from)} – ${formatDate(dateRange.to)}`
            }
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Wallet className="size-5" />}
            title={t('common.nothingInThisPeriod')}
            description={t('accounts.tryAWiderDateRangeOr')}
          />
        ) : (
          <ScrollRegion label={t('scroll.ledger')} className="border-t border-line-faint">
            <table className="w-full min-w-[640px] text-left">
              <caption className="sr-only">
                {t('accounts.statementFor')} {account.name}{t('accounts.showingARunningBalance')}
              </caption>
              <thead>
                <tr className="border-b border-line bg-sunken/60">
                  <th scope="col" className="label-eyebrow px-5 py-2.5 sm:px-6">{t('common.date')}</th>
                  <th scope="col" className="label-eyebrow px-3 py-2.5">{t('common.particulars')}</th>
                  <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">
                    {accountingView ? t('common.debit') : 'In'}
                  </th>
                  <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">
                    {accountingView ? t('common.credit') : 'Out'}
                  </th>
                  <th scope="col" className="label-eyebrow px-5 py-2.5 text-right sm:px-6">{t('common.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {/* The opening row anchors the arithmetic that follows. */}
                <tr className="border-b border-line-faint bg-sunken/30">
                  <td className="px-5 py-2.5 text-[12px] text-ink-muted sm:px-6" colSpan={4}>
                    {accountingView ? t('common.balanceBD') : t('common.openingBalance')}
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
                    {/* Below xl this column takes the leftover width (at least 10rem) and truncates,
                        so the table keeps its designed width instead of growing with the longest text. */}
                    <td className="px-3 py-3 max-xl:w-full max-xl:min-w-40 max-xl:max-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-ink">{row.description === PRIVATE_TRANSFER_LABEL ? t('transactions.privateTransfer') : row.description}</span>
                        {row.isContra && (
                          <Badge tone="neutral" eyebrow className="shrink-0">
                            {t('common.contra')}
                          </Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
                        {[
                          t.label('txType', row.type, TRANSACTION_META[row.type as keyof typeof TRANSACTION_META]?.label ?? row.type),
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
                    {accountingView ? t('common.balanceCD') : t('common.closingBalance')}
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
          </ScrollRegion>
        )}
      </Card>
    </div>
  );
}

/** Credit card centre (§Phase 7): utilisation and the next payment due date. */
function CreditCardSummary({ accountId }: { accountId: string }) {
  const t = useT();
  const { data } = useCardSummary(accountId);
  if (!data || (!data.creditLimitMinor && !data.dueDay)) return null;

  return (
    <Card>
      <CardHeader eyebrow={t('accounts.creditCard')} title={t('accounts.utilisationPayment')} />
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {data.creditLimitMinor !== undefined && (
          <div>
            <div className="flex items-baseline justify-between">
              <Money amountMinor={data.outstandingMinor} size="md" tone="negative" compactDecimals />
              <span className="text-[11.5px] text-ink-muted">{t('common.of')} <Money amountMinor={data.creditLimitMinor} size="xs" tone="neutral" compactDecimals /></span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-sunken">
              <div
                className={cn('h-full rounded-full', (data.utilizationPercent ?? 0) >= 80 ? 'bg-negative' : (data.utilizationPercent ?? 0) >= 50 ? 'bg-warning' : 'bg-positive')}
                style={{ width: `${Math.min(100, data.utilizationPercent ?? 0)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-ink-muted">{data.utilizationPercent ?? 0}{t('accounts.utilised')}</p>
          </div>
        )}
        {data.dueDay && (
          <div>
            <p className="label-eyebrow">{t('accounts.nextPaymentDue')}</p>
            <p className="mt-1 text-[14px] font-medium text-ink">
              {data.nextDueDate && formatDate(data.nextDueDate)}
              {data.daysUntilDue !== undefined && <span className="ml-1.5 text-ink-muted">({data.daysUntilDue === 0 ? 'today' : `${data.daysUntilDue}d`})</span>}
            </p>
            {data.minimumDueMinor !== undefined && (
              <p className="mt-0.5 text-[11.5px] text-ink-muted">
                {t('accounts.minimumDue2')} <Money amountMinor={data.minimumDueMinor} size="xs" tone="neutral" compactDecimals />
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
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
