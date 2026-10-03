import { useState } from 'react';
import { Check, Undo2 } from 'lucide-react';
import { REIMBURSEMENT_STATUSES, formatDate, type ReimbursementStatus, type TransactionDto } from '@khata/shared';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { Select } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth.store';
import { useInvalidateOrganise } from '../../lib/queries5';
import { useT } from '../../i18n';

/**
 * Track an expense that someone is going to pay back (§Phase 7): pending -> submitted -> approved ->
 * paid. This only records where the claim stands; it never changes the expense, a balance or the
 * income and expense totals. When the money arrives, record it as an income entry as usual and pick
 * it here as the payout so the two are linked.
 */
export function ReimbursementPanel({ transaction, onChanged }: { transaction: TransactionDto; onChanged: () => void }) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidateOrganise();
  const status = transaction.reimbursement?.status;
  const index = status ? REIMBURSEMENT_STATUSES.indexOf(status) : -1;
  const next = REIMBURSEMENT_STATUSES[index + 1];
  const previous = index > 0 ? REIMBURSEMENT_STATUSES[index - 1] : undefined;

  const [payoutId, setPayoutId] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const ws = useAuthStore((s) => s.activeWorkspaceId);
  const choosingPayout = next === 'paid';
  const { data: incomes = [] } = useQuery({
    queryKey: [ws, 'payout-candidates'],
    queryFn: async () => (await api.getWithMeta<{ items: TransactionDto[] }>('/transactions', { query: { types: 'income', limit: 20 } })).data.items,
    enabled: choosingPayout,
  });

  async function move(to: ReimbursementStatus | 'none') {
    setBusy(true);
    setProblem(null);
    try {
      await api.patch(`/transactions/${transaction.id}/reimbursement`, {
        status: to,
        rev: transaction.rev,
        ...(to === 'paid' && payoutId ? { payoutTransactionId: payoutId } : {}),
      });
      invalidate();
      onChanged();
      toast.success(to === 'none' ? t('reimb.stopped') : t('reimb.moved', { status: t(`reimb.status.${to}`) }));
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (transaction.type !== 'expense' || transaction.deletedAt) return null;

  if (!status) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-line px-4 py-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">{t('reimb.title')}</p>
          <p className="text-[12px] text-ink-muted">{t('reimb.hint')}</p>
        </div>
        <Button size="sm" variant="secondary" loading={busy} onClick={() => void move('pending')}>
          {t('reimb.track')}
        </Button>
      </div>
    );
  }

  return (
    <section aria-labelledby="reimb-heading" className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id="reimb-heading" className="text-[13px] font-medium text-ink">
          {t('reimb.title')}
        </h3>
        <Badge tone={status === 'paid' ? 'positive' : 'warning'}>{t(`reimb.status.${status}`)}</Badge>
      </div>

      <ol className="mt-3 flex items-center gap-1.5" aria-label={t('reimb.stages')}>
        {REIMBURSEMENT_STATUSES.map((stage, i) => (
          <li key={stage} className="flex flex-1 flex-col gap-1" aria-current={stage === status ? 'step' : undefined}>
            <span className={`h-1.5 rounded-full ${i <= index ? 'bg-gold' : 'bg-line'}`} aria-hidden />
            <span className={`text-[11px] ${stage === status ? 'font-semibold text-ink' : 'text-ink-muted'}`}>{t(`reimb.status.${stage}`)}</span>
          </li>
        ))}
      </ol>

      <p className="mt-3 text-[12px] text-ink-muted">
        {status === 'paid' ? (
          transaction.reimbursement?.payoutTransactionId ? (
            t('reimb.paidLinked')
          ) : (
            t('reimb.paidNotLinked')
          )
        ) : (
          <>
            {t('reimb.owedToYou')} <Money amountMinor={transaction.amountMinor} size="xs" tone="neutral" weight="medium" compactDecimals />
          </>
        )}{' '}
        · {t('reimb.updated', { date: formatDate(transaction.reimbursement!.updatedAt, 'dd MMM') })}
      </p>

      {choosingPayout && (
        <div className="mt-3 flex flex-col gap-1.5">
          <label htmlFor="payout" className="text-[12px] font-medium text-ink-secondary">
            {t('reimb.payout')}
          </label>
          <Select id="payout" value={payoutId} onChange={(e) => setPayoutId(e.target.value)}>
            <option value="">{t('reimb.noPayout')}</option>
            {incomes.map((income) => (
              <option key={income.id} value={income.id}>
                {formatDate(income.date, 'dd MMM')} · {income.description || income.categoryName || t('common.income')}
              </option>
            ))}
          </Select>
        </div>
      )}

      {problem && (
        <p role="alert" className="mt-3 text-[12.5px] text-negative">
          {problem}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {next && (
          <Button size="sm" variant="gold" leftIcon={<Check className="size-3.5" />} loading={busy} onClick={() => void move(next)}>
            {t('reimb.markAs', { status: t(`reimb.status.${next}`) })}
          </Button>
        )}
        {previous && (
          <Button size="sm" variant="ghost" leftIcon={<Undo2 className="size-3.5" />} loading={busy} onClick={() => void move(previous)}>
            {t('reimb.backTo', { status: t(`reimb.status.${previous}`) })}
          </Button>
        )}
        <Button size="sm" variant="ghost" loading={busy} onClick={() => void move('none')}>
          {t('reimb.stop')}
        </Button>
      </div>
    </section>
  );
}
