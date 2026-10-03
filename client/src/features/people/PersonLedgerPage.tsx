import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Banknote,
  CreditCard,
  FileDown,
  HandCoins,
  Pencil,
  Phone,
  Redo2,
  Undo2,
} from 'lucide-react';
import { TRANSACTION_META, formatDate, formatMoney } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { usePerson, usePersonLedger, useLoanTimeline } from '../../lib/queries';
import { downloadFile } from '../../lib/download';
import { errorMessage } from '../../lib/api';
import { useCurrency } from '../../hooks/useCurrency';
import { ShareButton } from '../../components/ShareButton';
import { Avatar } from './PeoplePage';
import { PersonFormSheet } from './PersonFormSheet';
import { LendBorrowSheet } from './LendBorrowSheet';
import { RepaySheet } from './RepaySheet';
import { SettleDialog } from './SettleDialog';
import { LoanDetailSheet } from './LoanDetailSheet';
import { useT } from '../../i18n';
import { ScrollRegion } from '../../components/ui/ScrollRegion';

/**
 * The person ledger (§13).
 *
 * Presented exactly as a paper khata is kept: one running column, oldest entry
 * first, ending at the figure shown everywhere else for this person. "You gave" and
 * "you received" are the column headers rather than debit/credit — the accounting
 * view toggle in Settings switches the vocabulary for users who want it (§54), but
 * the arithmetic underneath never changes.
 */
export function PersonLedgerPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { data: person } = usePerson(id);
  const { data: ledger, isLoading, isError, error, refetch } = usePersonLedger(id);

  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<'lend' | 'borrow' | 'repay' | 'settle' | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
  const toast = useToast();
  const currency = useCurrency();
  const { data: timeline = [] } = useLoanTimeline(id);
  const selectedLoanEntry = timeline.find((entry) => entry.loan.id === selectedLoanId) ?? null;

  async function exportPdf() {
    if (!id) return;
    setPdfBusy(true);
    try {
      await downloadFile(`/pdf/people/${id}`);
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

  if (!ledger) return null;
  const { summary, rows } = ledger;
  const subject = person ?? ledger.person;

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/people"
        className="flex w-fit items-center gap-1.5 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        {t('people.allPeople')}
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex items-center gap-4">
            <Avatar name={subject.name} avatarUrl={subject.avatarUrl} size="lg" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold tracking-[-0.01em] text-ink">{subject.name}</h1>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label={t('people.editPerson')}
                  className="rounded-sm p-1 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
                >
                  <Pencil aria-hidden className="size-3.5" />
                </button>
              </div>
              {subject.phone && (
                <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-ink-muted">
                  <Phone aria-hidden className="size-3.5" />
                  {subject.phone}
                </p>
              )}

              <div className="mt-2.5">
                <p className="label-eyebrow">
                  {summary.status === 'receivable'
                    ? t('people.youWillReceive')
                    : summary.status === 'payable'
                      ? t('people.youNeedToPay')
                      : t('common.settled')}
                </p>
                <Money
                  amountMinor={Math.abs(summary.outstandingMinor)}
                  size="xl"
                  tone={
                    summary.status === 'receivable'
                      ? 'positive'
                      : summary.status === 'payable'
                        ? 'negative'
                        : 'neutral'
                  }
                  compactDecimals
                />
                {summary.overdueMinor > 0 && (
                  <Badge tone="negative" className="ml-2 align-middle">
                    <Money amountMinor={summary.overdueMinor} size="xs" tone="inherit" compactDecimals /> {t('people.overdue')}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" leftIcon={<HandCoins className="size-4" />} onClick={() => setAction('lend')}>
              {t('people.lend')}
            </Button>
            <Button variant="secondary" leftIcon={<CreditCard className="size-4" />} onClick={() => setAction('borrow')}>
              {t('people.borrow')}
            </Button>
            <Button variant="secondary" leftIcon={<Undo2 className="size-4" />} onClick={() => setAction('repay')}>
              {t('people.repay')}
            </Button>
            <Button variant="ghost" leftIcon={<FileDown className="size-4" />} loading={pdfBusy} onClick={() => void exportPdf()}>
              PDF
            </Button>
            <ShareButton
              variant="ghost"
              content={{
                title: t('people.shareTitle', { name: subject.name }),
                text:
                  summary.status === 'settled'
                    ? t('people.settledUpWithYou', { name: subject.name })
                    : t(summary.status === 'receivable' ? 'people.shareOwesYou' : 'people.shareIsOwed', {
                        name: subject.name,
                        amount: formatMoney(Math.abs(summary.outstandingMinor), { currency, compactDecimals: true }),
                        overdue: summary.overdueMinor > 0 ? ` ${t('people.partOverdueSuffix')}` : '',
                      }),
              }}
            />
            {summary.outstandingMinor !== 0 && (
              <Button variant="gold" leftIcon={<Redo2 className="size-4" />} onClick={() => setAction('settle')}>
                {t('people.settle')}
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label={t('common.openingBalance')} amountMinor={summary.openingBalanceMinor} />
        <StatTile label={t('people.totalGiven')} amountMinor={summary.totalGivenMinor} tone="positive" />
        <StatTile label={t('people.totalReceived')} amountMinor={summary.totalReceivedMinor} tone="negative" />
      </div>

      <Card bare>
        <div className="p-5 pb-3 sm:p-6 sm:pb-3">
          <CardHeader eyebrow={t('people.ledger')} title={t('people.fullHistory')} />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Banknote className="size-5" />}
            title={t('common.noTransactionsYet')}
            description={t('people.recordWhatYouGaveOrReceived', { name: subject.name })}
            action={
              <Button variant="gold" size="sm" leftIcon={<HandCoins className="size-4" />} onClick={() => setAction('lend')}>
                {t('people.giveMoney')}
              </Button>
            }
          />
        ) : (
          <ScrollRegion label={t('scroll.ledger')} className="border-t border-line-faint">
            <table className="w-full min-w-[560px] text-left">
              <caption className="sr-only">{t('people.ledgerFor')} {subject.name}</caption>
              <thead>
                <tr className="border-b border-line bg-sunken/60">
                  <th scope="col" className="label-eyebrow px-5 py-2.5 sm:px-6">{t('common.date')}</th>
                  <th scope="col" className="label-eyebrow px-3 py-2.5">{t('common.description')}</th>
                  <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{t('people.youGave')}</th>
                  <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">{t('people.youReceived')}</th>
                  <th scope="col" className="label-eyebrow px-5 py-2.5 text-right sm:px-6">{t('common.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.openingBalanceMinor !== 0 && (
                  <tr className="border-b border-line-faint bg-sunken/30">
                    <td className="px-5 py-2.5 text-[12px] text-ink-muted sm:px-6" colSpan={4}>
                      {t('common.openingBalance')}
                    </td>
                    <td className="px-5 py-2.5 text-right sm:px-6">
                      <Money amountMinor={summary.openingBalanceMinor} size="sm" tone="neutral" weight="medium" compactDecimals />
                    </td>
                  </tr>
                )}

                {rows.map((row) => {
                  const isLoanRow = row.type === 'lend' || row.type === 'borrow';
                  return (
                  <tr
                    key={row.id}
                    onClick={isLoanRow ? () => setSelectedLoanId(row.id) : undefined}
                    className={cn(
                      'border-b border-line-faint last:border-0 hover:bg-sunken/40',
                      isLoanRow && 'cursor-pointer',
                    )}
                  >
                    <td className="whitespace-nowrap px-5 py-3 text-[12.5px] text-ink-muted sm:px-6">
                      {formatDate(row.date, 'dd MMM yyyy')}
                    </td>
                    {/* Below xl this column takes the leftover width (at least 10rem) and truncates,
                        so the table keeps its designed width instead of growing with the longest text. */}
                    <td className="px-3 py-3 max-xl:w-full max-xl:min-w-40 max-xl:max-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-ink">{row.description}</span>
                        {row.isSettlement && (
                          <Badge tone="positive" eyebrow className="shrink-0">
                            {t('common.settled')}
                          </Badge>
                        )}
                        {row.dueDate && (
                          <Badge tone="outline" eyebrow className="shrink-0">
                            {t('common.due')} {formatDate(row.dueDate, 'dd MMM')}
                          </Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
                        {t.label('txType', row.type, TRANSACTION_META[row.type as keyof typeof TRANSACTION_META]?.label ?? row.type)}
                        {row.accountName ? ` · ${row.accountName}` : ''}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {row.gaveMinor > 0 && (
                        <Money amountMinor={row.gaveMinor} size="sm" tone="positive" compactDecimals />
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {row.receivedMinor > 0 && (
                        <Money amountMinor={row.receivedMinor} size="sm" tone="negative" compactDecimals />
                      )}
                    </td>
                    <td className="px-5 py-3 text-right sm:px-6">
                      <Money
                        amountMinor={row.balanceMinor}
                        size="sm"
                        tone={row.balanceMinor === 0 ? 'neutral' : row.balanceMinor > 0 ? 'positive' : 'negative'}
                        weight="medium"
                        compactDecimals
                      />
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </Card>

      <PersonFormSheet open={editing} person={person ?? null} onClose={() => setEditing(false)} />

      {id && (
        <>
          <LendBorrowSheet
            personId={id}
            personName={subject.name}
            mode={action === 'lend' || action === 'borrow' ? action : null}
            onClose={() => setAction(null)}
          />
          <RepaySheet
            personId={id}
            personName={subject.name}
            personBalanceMinor={summary.outstandingMinor}
            open={action === 'repay'}
            onClose={() => setAction(null)}
          />
          <SettleDialog
            personId={id}
            personName={subject.name}
            outstandingMinor={summary.outstandingMinor}
            open={action === 'settle'}
            onClose={() => setAction(null)}
          />
          <LoanDetailSheet
            personId={id}
            personName={subject.name}
            entry={selectedLoanEntry}
            onClose={() => setSelectedLoanId(null)}
          />
        </>
      )}
    </div>
  );
}

function StatTile({
  label,
  amountMinor,
  tone = 'neutral',
}: {
  label: string;
  amountMinor: number;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div className={cn('rounded-lg border border-line bg-surface px-4 py-3.5 shadow-xs')}>
      <p className="label-eyebrow">{label}</p>
      <div className="mt-1.5">
        <Money amountMinor={amountMinor} size="md" tone={tone} compactDecimals />
      </div>
    </div>
  );
}
