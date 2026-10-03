import { useState } from 'react';
import { Coins, ClipboardList, Plus, RefreshCw } from 'lucide-react';
import { formatDate, formatMoney, type PettyCashDto } from '@khata/shared';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { Field, Select } from '../../components/ui/Input';
import { Sheet } from '../../components/ui/Sheet';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { usePettyCash, usePettyCashReport, useInvalidateBusiness } from '../../lib/queries4';
import { useAccounts } from '../../lib/queries';
import { useCurrency } from '../../hooks/useCurrency';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useT } from '../../i18n';

/**
 * Petty cash (§22).
 *
 * Under the imprest system the float always returns to the same target amount —
 * "Replenish" is deliberately a single button with no amount field, because the
 * correct replenishment amount is never a judgement call, it's exactly what was
 * spent since the last top-up.
 */
export function PettyCashPage() {
  const t = useT();
  const { data: records = [], isLoading, isError, error, refetch } = usePettyCash();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{t('nav.petty-cash')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">{t('business.imprestFloatsAndReplenishment')}</p>
        </div>
        <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          {t('business.setUpPettyCash')}
        </Button>
      </header>

      {isLoading ? (
        <Card>
          <LoadingState rows={3} />
        </Card>
      ) : isError ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : records.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Coins className="size-5" />}
            title={t('business.noPettyCashSetUp')}
            description={t('business.pickACashAccountSetIts')}
            action={
              <Button variant="gold" size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                {t('business.setUpPettyCash')}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {records.map((record) => (
            <PettyCashCard key={record.id} record={record} />
          ))}
        </div>
      )}

      <SetupSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function PettyCashCard({ record }: { record: PettyCashDto }) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateBusiness();
  const currency = useCurrency();
  const [busy, setBusy] = useState(false);
  const [counting, setCounting] = useState(false);
  const [viewingReport, setViewingReport] = useState(false);

  const percentRemaining = record.imprestMinor > 0 ? (record.currentMinor / record.imprestMinor) * 100 : 0;

  async function replenish() {
    setBusy(true);
    try {
      const result = await api.post<{ replenishedMinor: number }>(`/petty-cash/${record.id}/replenish`);
      invalidate();
      toast.success(t('business.floatReplenished'), t('business.addedBack', { amount: formatMoney(result.replenishedMinor, { currency, compactDecimals: true }) }));
    } catch (err) {
      toast.error(t('business.couldNotReplenish'), err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[14px] font-semibold text-ink">{record.accountName}</p>
          {record.custodian && <p className="mt-0.5 text-[11.5px] text-ink-muted">{t('business.heldBy')} {record.custodian}</p>}
        </div>
        <Coins aria-hidden className="size-5 text-gold" />
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <Money amountMinor={record.currentMinor} size="lg" tone="neutral" compactDecimals />
          <span className="sensitive text-[12px] text-ink-muted">{t('common.of')} {formatMoney(record.imprestMinor, { currency, compactDecimals: true })} {t('business.float')}</span>
        </div>
        <div aria-hidden className="mt-2.5 h-2 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-gold transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, percentRemaining))}%` }} />
        </div>
      </div>

      {record.spentSinceReplenishMinor > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line-faint bg-sunken px-3.5 py-2.5">
          <span className="text-[12px] text-ink-muted">
            {t('business.spentSinceLastTopUp')} <Money amountMinor={record.spentSinceReplenishMinor} size="xs" tone="inherit" weight="medium" compactDecimals />
          </span>
          <Button size="sm" variant="secondary" loading={busy} leftIcon={<RefreshCw className="size-3.5" />} onClick={() => void replenish()}>
            {t('business.replenish')}
          </Button>
        </div>
      ) : (
        <p className="rounded-md border border-line-faint bg-positive-soft px-3.5 py-2.5 text-[12px] text-positive">{t('business.floatIsFullyToppedUp')}</p>
      )}

      <div className="flex gap-2">
        <Button size="sm" variant="secondary" className="flex-1" onClick={() => setCounting(true)}>
          {t('business.countCash')}
        </Button>
        <Button size="sm" variant="ghost" leftIcon={<ClipboardList className="size-3.5" />} onClick={() => setViewingReport(true)}>
          {t('business.report')}
        </Button>
      </div>

      <CountSheet open={counting} pettyCash={record} onClose={() => setCounting(false)} />
      <ReportSheet open={viewingReport} pettyCash={record} onClose={() => setViewingReport(false)} />
    </Card>
  );
}

function CountSheet({ open, pettyCash, onClose }: { open: boolean; pettyCash: PettyCashDto; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateBusiness();
  const currency = useCurrency();
  const [countedMinor, setCountedMinor] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (countedMinor === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ differenceMinor: number }>(`/petty-cash/${pettyCash.id}/count`, { countedMinor, note: note || undefined });
      invalidate();
      const diff = result.differenceMinor;
      if (diff === 0) toast.success(t('business.countedMatchesExactly'));
      else toast.error(diff > 0 ? t('business.countedMoreThanExpected') : t('business.countedShort'), t('business.differenceSigned', { diff: `${diff > 0 ? '+' : ''}${diff}` }));
      setCountedMinor(null);
      setNote('');
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('business.countTheDrawer')}
      description={t('business.expectedRightNow', { amount: formatMoney(pettyCash.currentMinor, { currency }) })}
      size="sm"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={countedMinor === null} onClick={() => void submit()}>
            {t('business.recordCount')}
          </Button>
        </div>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="flex flex-col gap-4 pb-2">
        {error && (
          <div role="alert" className="rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] text-negative">
            {error}
          </div>
        )}
        <Field label={t('business.countedAmount')} required>
          {({ id }) => <MoneyInput id={id} size="hero" autoFocus value={countedMinor} onChange={setCountedMinor} />}
        </Field>
        <Field label={t('common.note')} hint={t('common.optional')}>
          {({ id }) => (
            <input
              id={id}
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              className="h-11 w-full rounded-md border border-line bg-sunken px-3.5 text-[15px] text-ink focus:border-gold focus:bg-surface focus:outline-none focus:ring-4 focus:ring-[--k-gold-ring]"
            />
          )}
        </Field>
      </form>
    </Sheet>
  );
}

function ReportSheet({ open, pettyCash, onClose }: { open: boolean; pettyCash: PettyCashDto; onClose: () => void }) {
  const t = useT();
  const { data: report, isLoading } = usePettyCashReport(open ? pettyCash.id : undefined);

  return (
    <Sheet open={open} onClose={onClose} title={t('business.report2', { accountName: pettyCash.accountName ?? '' })} size="md">
      {isLoading ? (
        <p className="text-[13px] text-ink-muted">{t('common.loading')}</p>
      ) : !report ? null : (
        <div className="flex flex-col gap-5">
          <div>
            <h3 className="text-[13px] font-medium text-ink">{t('business.spendSinceLastTopUpBy')}</h3>
            {report.spendByCategory.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-ink-muted">{t('business.nothingSpentYet')}</p>
            ) : (
              <ul className="mt-2 divide-y divide-line-faint rounded-md border border-line">
                {report.spendByCategory.map((row) => (
                  <li key={row.categoryId ?? 'none'} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[12.5px]">
                    <span className="text-ink">{row.categoryName}</span>
                    <Money amountMinor={row.amountMinor} size="sm" />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-[13px] font-medium text-ink">{t('business.recentCounts')}</h3>
            {report.recentCounts.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-ink-muted">{t('business.noCountsRecordedYet')}</p>
            ) : (
              <ul className="mt-2 divide-y divide-line-faint rounded-md border border-line">
                {report.recentCounts.map((count) => (
                  <li key={count.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[12.5px]">
                    <span className="text-ink-muted">{formatDate(count.countedAt)}</span>
                    <Money amountMinor={count.differenceMinor} size="sm" tone={count.differenceMinor === 0 ? 'neutral' : count.differenceMinor > 0 ? 'positive' : 'negative'} signed />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function SetupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateBusiness();
  const { data: accounts = [] } = useAccounts();
  const cashAccounts = accounts.filter((a) => a.type === 'cash');
  const fundingAccounts = accounts.filter((a) => a.type !== 'cash');

  const [accountId, setAccountId] = useState('');
  const [imprestMinor, setImprestMinor] = useState<number | null>(null);
  const [replenishFromAccountId, setReplenishFromAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!accountId || !imprestMinor || imprestMinor <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/petty-cash', { accountId, imprestMinor, replenishFromAccountId: replenishFromAccountId || undefined });
      invalidate();
      toast.success(t('business.pettyCashSetUp'));
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('business.setUpPettyCash')}
      description={t('business.chooseACashAccountAndIts')}
      size="sm"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={!accountId || !imprestMinor} onClick={() => void save()}>
            {t('business.setUp')}
          </Button>
        </div>
      }
    >
      <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="flex flex-col gap-4 pb-2">
        {error && (
          <div role="alert" className="rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] text-negative">
            {error}
          </div>
        )}
        <Field label={t('business.cashAccount')} required>
          {({ id }) => (
            <Select id={id} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">{t('common.choose')}</option>
              {cashAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('business.imprestFloat')} hint={t('business.theAmountThisDrawerIsAlways')} required>
          {({ id }) => <MoneyInput id={id} size="hero" value={imprestMinor} onChange={setImprestMinor} />}
        </Field>
        <Field label={t('business.replenishFrom')} hint={t('business.optionalTheAccountReplenishmentsAreDrawn')}>
          {({ id }) => (
            <Select id={id} value={replenishFromAccountId} onChange={(event) => setReplenishFromAccountId(event.target.value)}>
              <option value="">{t('business.chooseEachTime')}</option>
              {fundingAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </Sheet>
  );
}
