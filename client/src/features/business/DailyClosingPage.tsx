import { useMemo, useState } from 'react';
import { CalendarCheck, Check } from 'lucide-react';
import { formatDate, toDateKey } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useDayClosingPreview, useDayClosings, useInvalidateBusiness } from '../../lib/queries4';
import { useAccounts } from '../../lib/queries';
import { api, ApiRequestError, errorMessage } from '../../lib/api';

/**
 * Daily cash closing (§32).
 *
 * "Expected" is computed purely from the ledger — opening plus receipts minus
 * payments — exactly the way a running balance is computed everywhere else in the
 * app. The user only ever supplies one number: what's actually in the drawer. The
 * difference is arithmetic, not opinion.
 */
export function DailyClosingPage() {
  const { data: accounts = [] } = useAccounts();
  const cashAccounts = useMemo(() => accounts.filter((a) => a.type === 'cash'), [accounts]);

  const [date, setDate] = useState(toDateKey(new Date()));
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [actualClosing, setActualClosing] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const toast = useToast();
  const invalidate = useInvalidateBusiness();
  const { data: preview, isLoading: previewLoading } = useDayClosingPreview(date, selectedAccountIds);
  const { data: history = [], isLoading, isError, error, refetch } = useDayClosings();

  const alreadyClosed = history.some((c) => toDateKey(new Date(c.date)) === date);
  const difference = preview && actualClosing !== null ? actualClosing - preview.expectedClosingMinor : null;

  async function close() {
    if (actualClosing === null || !preview) return;
    setBusy(true);
    try {
      await api.post('/closing/day', {
        date: new Date(`${date}T12:00:00`).toISOString(),
        actualClosingMinor: actualClosing,
        accountIds: selectedAccountIds.length ? selectedAccountIds : undefined,
        note: note.trim() || undefined,
      });
      invalidate();
      toast.success('Day closed', difference === 0 ? 'The drawer matched exactly.' : `Difference recorded.`);
      setActualClosing(null);
      setNote('');
    } catch (err) {
      toast.error('Could not close the day', err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function reopen(id: string) {
    try {
      await api.post(`/closing/day/${id}/reopen`);
      invalidate();
      toast.success('Day reopened');
    } catch (err) {
      toast.error('Could not reopen that day', errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">Daily Closing</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">Count the drawer and reconcile against the ledger.</p>
      </header>

      <Card>
        <CardHeader eyebrow="Close a day" title="Cash count" />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="label-eyebrow">Date</span>
            <Input type="date" value={date} max={toDateKey(new Date())} onChange={(event) => { setDate(event.target.value); setActualClosing(null); }} />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="label-eyebrow">Accounts</span>
            <div className="flex flex-wrap gap-1.5">
              {cashAccounts.map((account) => {
                // No explicit selection means "every cash account" — the common
                // case for a shop with one drawer — so the chips read as active
                // until the user actually narrows them down.
                const active = selectedAccountIds.length === 0 || selectedAccountIds.includes(account.id);
                return (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() =>
                      setSelectedAccountIds((current) => {
                        const base = current.length === 0 ? cashAccounts.map((a) => a.id) : current;
                        return base.includes(account.id) ? base.filter((id) => id !== account.id) : [...base, account.id];
                      })
                    }
                    className={cn(
                      'rounded-sm border px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                      active ? 'border-gold bg-gold-soft text-gold-strong' : 'border-line bg-surface text-ink-muted hover:bg-sunken',
                    )}
                  >
                    {account.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {alreadyClosed ? (
          <p className="mt-5 rounded-md border border-line bg-sunken px-4 py-3 text-[13px] text-ink-muted">
            This day is already closed. Reopen it below to close it again.
          </p>
        ) : (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <StatTile label="Opening cash" amountMinor={preview?.openingCashMinor ?? 0} loading={previewLoading} />
              <StatTile label="Received" amountMinor={preview?.cashReceivedMinor ?? 0} tone="positive" loading={previewLoading} />
              <StatTile label="Paid" amountMinor={preview?.cashPaidMinor ?? 0} tone="negative" loading={previewLoading} />
            </div>

            <div className="mt-4 rounded-lg border border-gold/30 bg-gold-soft/40 p-4">
              <p className="label-eyebrow">Expected closing cash</p>
              <div className="mt-1.5">
                <Money amountMinor={preview?.expectedClosingMinor ?? 0} size="xl" tone="neutral" compactDecimals />
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="label-eyebrow">Actual closing cash</span>
                <MoneyInput value={actualClosing} onChange={setActualClosing} size="hero" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="label-eyebrow">Note (optional)</span>
                <Input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Investigate a shortfall, etc." />
              </label>
            </div>

            {difference !== null && difference !== 0 && (
              <div className={cn('mt-4 flex items-center justify-between rounded-md border px-4 py-3', difference < 0 ? 'border-negative/25 bg-negative-soft' : 'border-positive/25 bg-positive-soft')}>
                <span className="text-[13px] font-medium text-ink">{difference < 0 ? 'Shortfall' : 'Surplus'}</span>
                <Money amountMinor={Math.abs(difference)} size="md" tone={difference < 0 ? 'negative' : 'positive'} compactDecimals />
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <Button variant="gold" loading={busy} disabled={actualClosing === null} leftIcon={<Check className="size-4" />} onClick={() => void close()}>
                Close day
              </Button>
            </div>
          </>
        )}
      </Card>

      <Card bare>
        <div className="p-5 pb-3 sm:p-6 sm:pb-3">
          <CardHeader eyebrow="History" title="Recent closings" />
        </div>
        {isLoading ? (
          <div className="p-5">
            <LoadingState rows={3} />
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : history.length === 0 ? (
          <EmptyState icon={<CalendarCheck className="size-5" />} title="No closings yet" description="Close your first day above to start a history." />
        ) : (
          <ul className="divide-y divide-line-faint border-t border-line-faint">
            {history.map((closing) => (
              <li key={closing.id} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink">{formatDate(closing.date, 'dd MMM yyyy')}</p>
                  <p className="mt-0.5 text-[11.5px] text-ink-muted">
                    Expected <Money amountMinor={closing.expectedClosingMinor} size="xs" tone="inherit" compactDecimals /> · Actual{' '}
                    <Money amountMinor={closing.actualClosingMinor} size="xs" tone="inherit" compactDecimals />
                  </p>
                </div>
                {closing.differenceMinor === 0 ? (
                  <Badge tone="positive">Matched</Badge>
                ) : (
                  <Money amountMinor={closing.differenceMinor} size="sm" tone={closing.differenceMinor < 0 ? 'negative' : 'positive'} signed compactDecimals />
                )}
                <Button variant="ghost" size="sm" onClick={() => void reopen(closing.id)}>
                  Reopen
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function StatTile({ label, amountMinor, tone = 'neutral', loading }: { label: string; amountMinor: number; tone?: 'positive' | 'negative' | 'neutral'; loading?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3 shadow-xs">
      <p className="label-eyebrow">{label}</p>
      <div className="mt-1.5">{loading ? <div className="skeleton h-5 w-20" /> : <Money amountMinor={amountMinor} size="md" tone={tone} compactDecimals />}</div>
    </div>
  );
}
