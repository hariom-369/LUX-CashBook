import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Users } from 'lucide-react';
import { formatDate } from '@khata/shared';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { ConfirmDialog } from '../../components/ui/Sheet';
import { useToast } from '../../components/ui/Toast';
import { useGroup, useGroupBalances, useGroupExpenses, useInvalidateGroup } from '../../lib/queries3';
import { api, errorMessage } from '../../lib/api';
import { AddGroupExpenseSheet } from './AddGroupExpenseSheet';
import { useT } from '../../i18n';

/**
 * One group's balances and expense history (docs/FEATURE_ROADMAP.md Phase 8).
 * Every member's balance is a straight read of real `lend` transactions — no
 * separate running total this page could ever disagree with the person
 * ledger about. Settling is the ordinary repay flow from People, not
 * something this page offers itself.
 */
export function GroupDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { data: group, isLoading, isError, error, refetch } = useGroup(id);
  const { data: balances = [] } = useGroupBalances(id);
  const { data: expenses = [], isLoading: expensesLoading } = useGroupExpenses(id);
  const invalidate = useInvalidateGroup(id);
  const toast = useToast();

  const [addingExpense, setAddingExpense] = useState(false);
  const [removingExpenseId, setRemovingExpenseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function removeExpense() {
    if (!removingExpenseId || !id) return;
    setBusy(true);
    try {
      await api.delete(`/groups/${id}/expenses/${removingExpenseId}`);
      invalidate();
      toast.success(t('groups.expenseRemoved'));
    } catch (err) {
      toast.error(t('common.couldNotRemoveThat'), errorMessage(err));
    } finally {
      setBusy(false);
      setRemovingExpenseId(null);
    }
  }

  if (isLoading) return <Card><LoadingState rows={5} /></Card>;
  if (isError) return <Card><ErrorState titleAs="h1" error={error} onRetry={() => void refetch()} /></Card>;
  if (!group) return null;

  return (
    <div className="flex flex-col gap-5">
      <Link to="/groups" className="flex w-fit items-center gap-1.5 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink">
        <ArrowLeft aria-hidden className="size-3.5" />
        {t('groups.allGroups')}
      </Link>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-gold-soft text-gold-strong">
              <Users className="size-[18px]" />
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-[-0.01em] text-ink">{group.name}</h1>
              <p className="mt-0.5 text-[12.5px] text-ink-muted">{group.memberNames.join(', ')}</p>
            </div>
          </div>
          <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setAddingExpense(true)}>
            {t('groups.addExpense')}
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow={t('groups.balances')} title={t('groups.whoOwesYou')} />
        <ul className="mt-3 flex flex-col divide-y divide-line-faint">
          {balances.map((b) => (
            <li key={b.personId} className="flex items-center justify-between py-2.5">
              <Link to={`/people/${b.personId}`} className="text-[13px] text-ink hover:underline">
                {b.personName}
              </Link>
              {b.outstandingMinor === 0 ? (
                <Badge tone="positive" eyebrow>{t('common.settled')}</Badge>
              ) : (
                <Money amountMinor={b.outstandingMinor} size="sm" tone="positive" compactDecimals />
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11.5px] text-ink-muted">
          {t('groups.toSettleRecordARepaymentFrom')}
        </p>
      </Card>

      <Card bare>
        <div className="p-5 pb-3 sm:p-6 sm:pb-3">
          <CardHeader eyebrow={t('common.history')} title={t('groups.groupExpenses')} />
        </div>
        {expensesLoading ? (
          <div className="p-5"><LoadingState rows={3} /></div>
        ) : expenses.length === 0 ? (
          <EmptyState title={t('groups.noExpensesYet')} description={t('groups.addWhatYouPaidForThe')} />
        ) : (
          <ul className="divide-y divide-line-faint">
            {expenses.map((expense) => (
              <li key={expense.id} className="flex items-center gap-3.5 px-5 py-4 sm:px-6">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{expense.description || t('groups.groupExpense')}</p>
                  <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                    {formatDate(expense.date)} · {expense.accountName} · {t.plural('groups.membersOwe', expense.memberShares.length)}
                  </p>
                </div>
                <Money amountMinor={expense.totalAmountMinor} size="sm" tone="negative" compactDecimals />
                <button
                  type="button"
                  onClick={() => setRemovingExpenseId(expense.id)}
                  aria-label={t('groups.removeExpense')}
                  className="rounded-sm p-1.5 text-ink-faint transition-colors hover:text-negative"
                >
                  <Trash2 aria-hidden className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <AddGroupExpenseSheet group={group} open={addingExpense} onClose={() => setAddingExpense(false)} />

      <ConfirmDialog
        open={Boolean(removingExpenseId)}
        onCancel={() => setRemovingExpenseId(null)}
        onConfirm={removeExpense}
        title={t('groups.removeThisGroupExpense')}
        description={t('groups.deletesTheTransactionsItCreatedYour')}
        confirmLabel={t('common.remove')}
        tone="danger"
        busy={busy}
      />
    </div>
  );
}
