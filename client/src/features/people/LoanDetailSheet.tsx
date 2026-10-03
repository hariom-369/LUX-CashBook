import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { formatDate, formatMoney, toDateKey, type LoanTimelineEntryDto } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth.store';
import { useCurrency } from '../../hooks/useCurrency';
import { api, errorMessage } from '../../lib/api';
import { AttachmentList } from '../transactions/AttachmentList';
import { ShareButton } from '../../components/ShareButton';
import { useT } from '../../i18n';

/**
 * One loan's own lifecycle (docs/FEATURE_ROADMAP.md Phase 4: "lent ₹10,000 →
 * repaid ₹2,000 → repaid ₹3,000 → remaining ₹5,000") — the person ledger shows
 * every transaction in one running column; this pulls a single loan's thread
 * out of it, plus an optional installment schedule and its own reminder text.
 */
export function LoanDetailSheet({
  personId,
  personName,
  entry,
  onClose,
}: {
  personId: string;
  personName: string;
  entry: LoanTimelineEntryDto | null;
  onClose: () => void;
}) {
  const t = useT();
  const currency = useCurrency();
  const queryClient = useQueryClient();
  const ws = useAuthStore((s) => s.activeWorkspaceId ?? 'none');
  const [editingPlan, setEditingPlan] = useState(false);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: [ws, 'loan-timeline', personId] });
  }

  const isLend = entry?.loan.type === 'lend';
  const reminderText = entry
    ? isLend
      ? t('people.loanReminderOwesYou', { name: personName, amount: formatMoney(entry.remainingMinor, { currency, compactDecimals: true }), due: entry.loan.dueDate ? t('people.dueSuffix', { date: formatDate(entry.loan.dueDate) }) : '' })
      : t('people.loanReminderYouOwe', { name: personName, amount: formatMoney(entry.remainingMinor, { currency, compactDecimals: true }), due: entry.loan.dueDate ? t('people.dueSuffix', { date: formatDate(entry.loan.dueDate) }) : '' })
    : '';

  return (
    <Sheet
      open={Boolean(entry)}
      onClose={onClose}
      title={entry ? entry.loan.description || (isLend ? t('people.moneyLent') : t('people.moneyBorrowed')) : ''}
      size="md"
    >
      {entry && (
        <div className="flex flex-col gap-5 pb-2">
          <div className="flex items-center justify-between rounded-lg border border-line bg-sunken/50 px-4 py-3.5">
            <div>
              <p className="label-eyebrow">{t('people.remaining')}</p>
              <Money amountMinor={entry.remainingMinor} size="lg" tone={entry.remainingMinor === 0 ? 'neutral' : isLend ? 'positive' : 'negative'} compactDecimals />
            </div>
            {entry.loan.dueDate && (
              <Badge tone={entry.remainingMinor > 0 && new Date(entry.loan.dueDate) < new Date() ? 'negative' : 'outline'}>
                {t('common.due')} {formatDate(entry.loan.dueDate)}
              </Badge>
            )}
          </div>

          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted">{t('people.timeline')}</p>
            <ul className="mt-2 flex flex-col gap-2">
              <TimelineRow
                label={isLend ? t('people.lentTo', { name: personName }) : t('people.borrowedFrom', { name: personName })}
                date={entry.loan.date}
                amountMinor={entry.loan.amountMinor}
                tone={isLend ? 'positive' : 'negative'}
              />
              {entry.repayments.map((r) => (
                <TimelineRow
                  key={r.id}
                  label={r.type === 'repayment_given' ? t('people.youRepaid', { name: personName }) : t('people.repaidYou', { name: personName })}
                  date={r.date}
                  amountMinor={r.amountMinor}
                  tone="neutral"
                />
              ))}
              <TimelineRow label={t('people.remaining')} amountMinor={entry.remainingMinor} tone="gold" isTotal />
            </ul>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted">{t('people.installmentSchedule')}</p>
              {entry.installmentPlan && !editingPlan && (
                <button type="button" onClick={() => setEditingPlan(true)} className="text-[12px] font-medium text-gold-strong hover:underline">
                  {t('common.edit')}
                </button>
              )}
            </div>

            {editingPlan || !entry.installmentPlan ? (
              <InstallmentEditor
                transactionId={entry.loan.id}
                existing={entry.installmentPlan}
                loanAmountMinor={entry.loan.amountMinor}
                onSaved={() => {
                  setEditingPlan(false);
                  invalidate();
                }}
                onCancel={() => setEditingPlan(false)}
                onRemoved={() => {
                  setEditingPlan(false);
                  invalidate();
                }}
              />
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {entry.installmentPlan.installments.map((i) => (
                  <li key={i.dueDate} className="flex items-center justify-between rounded-md border border-line-faint px-3 py-2">
                    <span className="text-[12.5px] text-ink">{formatDate(i.dueDate)}</span>
                    <div className="flex items-center gap-2">
                      <Money amountMinor={i.amountMinor} size="sm" tone="neutral" compactDecimals />
                      <Badge tone={i.status === 'paid' ? 'positive' : i.status === 'overdue' ? 'negative' : 'outline'} eyebrow>
                        {i.status}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {entry.remainingMinor > 0 && (
            <ShareButton content={{ title: t('people.paymentReminder'), text: reminderText }} label={t('people.sendReminder')} variant="secondary" />
          )}

          <div className="border-t border-line-faint pt-4">
            <AttachmentList transactionId={entry.loan.id} attachments={entry.loan.attachments} />
          </div>
        </div>
      )}
    </Sheet>
  );
}

function TimelineRow({
  label,
  date,
  amountMinor,
  tone,
  isTotal = false,
}: {
  label: string;
  date?: string;
  amountMinor: number;
  tone: 'positive' | 'negative' | 'neutral' | 'gold';
  isTotal?: boolean;
}) {
  return (
    <li className={cn('flex items-center justify-between rounded-md px-3 py-2', isTotal ? 'border border-gold/30 bg-gold-soft' : 'border border-line-faint')}>
      <span className="text-[12.5px] text-ink">
        {label}
        {date && <span className="ml-2 text-ink-muted">{formatDate(date)}</span>}
      </span>
      <Money amountMinor={amountMinor} size="sm" tone={tone === 'gold' ? 'neutral' : tone} weight={isTotal ? 'semibold' : 'normal'} compactDecimals />
    </li>
  );
}

function InstallmentEditor({
  transactionId,
  existing,
  loanAmountMinor,
  onSaved,
  onCancel,
  onRemoved,
}: {
  transactionId: string;
  existing: LoanTimelineEntryDto['installmentPlan'];
  loanAmountMinor: number;
  onSaved: () => void;
  onCancel: () => void;
  onRemoved: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [rows, setRows] = useState<Array<{ dueDate: string; amountMinor: number }>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRows(
      existing
        ? existing.installments.map((i) => ({ dueDate: toDateKey(new Date(i.dueDate)), amountMinor: i.amountMinor }))
        : [{ dueDate: toDateKey(new Date()), amountMinor: loanAmountMinor }],
    );
  }, [existing, loanAmountMinor]);

  const total = rows.reduce((sum, r) => sum + (r.amountMinor || 0), 0);

  async function save() {
    setBusy(true);
    try {
      await api.put(`/loans/${transactionId}/installments`, {
        installments: rows.map((r) => ({ dueDate: new Date(`${r.dueDate}T12:00:00`).toISOString(), amountMinor: r.amountMinor })),
      });
      toast.success(t('people.installmentScheduleSaved'));
      onSaved();
    } catch (err) {
      toast.error(t('common.couldNotSaveThat'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.delete(`/loans/${transactionId}/installments`);
      toast.success(t('people.installmentScheduleRemoved'));
      onRemoved();
    } catch (err) {
      toast.error(t('common.couldNotRemoveThat'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            type="date"
            value={row.dueDate}
            onChange={(e) => setRows((r) => r.map((x, i) => (i === index ? { ...x, dueDate: e.target.value } : x)))}
          />
          <Input
            type="number"
            min={1}
            value={row.amountMinor / 100}
            onChange={(e) => setRows((r) => r.map((x, i) => (i === index ? { ...x, amountMinor: Math.round(Number(e.target.value) * 100) } : x)))}
          />
          <button
            type="button"
            aria-label={t('people.removeInstallment')}
            onClick={() => setRows((r) => r.filter((_, i) => i !== index))}
            disabled={rows.length <= 1}
            className="rounded-sm p-2 text-ink-muted transition-colors hover:bg-sunken hover:text-negative disabled:opacity-40"
          >
            <Trash2 aria-hidden className="size-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows((r) => [...r, { dueDate: toDateKey(new Date()), amountMinor: 0 }])}
        className="flex w-fit items-center gap-1.5 text-[12px] font-medium text-gold-strong hover:underline"
      >
        <Plus className="size-3.5" /> {t('people.addInstallment')}
      </button>
      <p className="text-[11.5px] text-ink-muted">
        {t('people.totalScheduled')} <Money amountMinor={total} size="xs" tone={total > loanAmountMinor ? 'negative' : 'neutral'} compactDecimals />
        {total > loanAmountMinor && ' — exceeds the loan amount'}
      </p>
      <div className="flex justify-end gap-2">
        {existing && (
          <Button variant="ghost" size="sm" loading={busy} onClick={() => void remove()}>
            {t('people.removeSchedule')}
          </Button>
        )}
        {existing && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
        <Button variant="gold" size="sm" loading={busy} disabled={total > loanAmountMinor || rows.some((r) => !r.amountMinor)} onClick={() => void save()}>
          {t('people.saveSchedule')}
        </Button>
      </div>
    </div>
  );
}
