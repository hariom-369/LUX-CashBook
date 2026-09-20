import { useState } from 'react';
import { CalendarRange, Check } from 'lucide-react';
import { monthLabel } from '@khata/shared';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { Select } from '../../components/ui/Input';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { ConfirmDialog } from '../../components/ui/Sheet';
import { useToast } from '../../components/ui/Toast';
import { useMonthClosings, useInvalidateBusiness } from '../../lib/queries4';
import { api, ApiRequestError, errorMessage } from '../../lib/api';

const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/**
 * Month-end closing (§33).
 *
 * Closing freezes a summary and blocks new writes into that period, but never
 * touches a single historical transaction — the numbers on a closed card are a
 * snapshot of what the ledger said at close time, kept alongside the still-intact
 * ledger rather than replacing it.
 */
export function MonthClosingPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [busy, setBusy] = useState(false);
  const [confirmReopenId, setConfirmReopenId] = useState<string | null>(null);

  const toast = useToast();
  const invalidate = useInvalidateBusiness();
  const { data: closings = [], isLoading, isError, error, refetch } = useMonthClosings();

  const alreadyClosed = closings.find((c) => c.year === year && c.month === month);

  async function close() {
    setBusy(true);
    try {
      await api.post('/closing/month', { year, month });
      invalidate();
      toast.success(`${monthLabel(year, month - 1, true)} closed`);
    } catch (err) {
      toast.error('Could not close that month', err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    if (!confirmReopenId) return;
    setBusy(true);
    try {
      await api.post(`/closing/month/${confirmReopenId}/reopen`);
      invalidate();
      toast.success('Month reopened');
    } catch (err) {
      toast.error('Could not reopen that month', errorMessage(err));
    } finally {
      setBusy(false);
      setConfirmReopenId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">Month Closing</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">Freeze a month's summary and file it — your history is never altered.</p>
      </header>

      <Card>
        <CardHeader eyebrow="Close a month" title="Choose a period" />
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="label-eyebrow">Month</span>
            <Select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="w-auto">
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(2000, m - 1, true).split(' ')[0]}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-eyebrow">Year</span>
            <Select value={year} onChange={(event) => setYear(Number(event.target.value))} className="w-auto">
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </label>

          {alreadyClosed ? (
            <p className="pb-2.5 text-[13px] text-ink-muted">This month is already closed.</p>
          ) : (
            <Button variant="gold" loading={busy} leftIcon={<Check className="size-4" />} onClick={() => void close()}>
              Close {monthLabel(year, month - 1, true)}
            </Button>
          )}
        </div>
      </Card>

      <Card bare>
        <div className="p-5 pb-3 sm:p-6 sm:pb-3">
          <CardHeader eyebrow="History" title="Closed months" />
        </div>
        {isLoading ? (
          <div className="p-5">
            <LoadingState rows={3} />
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : closings.length === 0 ? (
          <EmptyState icon={<CalendarRange className="size-5" />} title="No months closed yet" description="Close your first month above." />
        ) : (
          <div className="overflow-x-auto border-t border-line-faint">
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="border-b border-line bg-sunken/60">
                  <th scope="col" className="label-eyebrow px-5 py-2.5 sm:px-6">Month</th>
                  <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">Income</th>
                  <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">Expenses</th>
                  <th scope="col" className="label-eyebrow px-3 py-2.5 text-right">Closing Balance</th>
                  <th scope="col" className="label-eyebrow px-5 py-2.5 text-right sm:px-6" />
                </tr>
              </thead>
              <tbody>
                {closings.map((closing) => (
                  <tr key={closing.id} className="border-b border-line-faint last:border-0">
                    <td className="px-5 py-3 text-[13px] font-medium text-ink sm:px-6">{monthLabel(closing.year, closing.month - 1, true)}</td>
                    <td className="px-3 py-3 text-right"><Money amountMinor={closing.incomeMinor} size="sm" tone="positive" compactDecimals /></td>
                    <td className="px-3 py-3 text-right"><Money amountMinor={closing.expenseMinor} size="sm" tone="negative" compactDecimals /></td>
                    <td className="px-3 py-3 text-right"><Money amountMinor={closing.closingBalanceMinor} size="sm" tone="neutral" weight="medium" compactDecimals /></td>
                    <td className="px-5 py-3 text-right sm:px-6">
                      <Button variant="ghost" size="sm" onClick={() => setConfirmReopenId(closing.id)}>
                        Reopen
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(confirmReopenId)}
        onCancel={() => setConfirmReopenId(null)}
        onConfirm={reopen}
        title="Reopen this month?"
        description="You'll be able to add, edit and delete transactions in this period again."
        confirmLabel="Reopen"
        busy={busy}
      />
    </div>
  );
}
