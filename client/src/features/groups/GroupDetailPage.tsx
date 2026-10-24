import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, HandCoins, Pencil, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { formatDate, type GroupExpenseDto, type GroupSettlementSuggestionDto } from '@khata/shared';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { ConfirmDialog } from '../../components/ui/Sheet';
import { useToast } from '../../components/ui/Toast';
import { useGroup, useGroupExpenses, useGroupSummary, useInvalidateGroup } from '../../lib/queries3';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { AddGroupExpenseSheet } from './AddGroupExpenseSheet';
import { GroupFormSheet } from './GroupFormSheet';
import { GroupPaymentSheet } from './GroupPaymentSheet';
import { DeleteGroupDialog } from './DeleteGroupDialog';
import { useT } from '../../i18n';

/**
 * One group: everyone's paid / share / balance, what's still to settle, the
 * expense history and the payments already made. Balances come from the
 * group's own record of expenses and payments; your part of each is also in
 * your books (your share as an expense, the rest as loans and repayments), so
 * a person's balance here with you always matches their People ledger.
 */
export function GroupDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { data: group, isLoading, isError, error, refetch } = useGroup(id);
  const { data: summary } = useGroupSummary(id);
  const { data: expenses = [], isLoading: expensesLoading } = useGroupExpenses(id);
  const invalidate = useInvalidateGroup(id);
  const toast = useToast();

  const [expenseSheet, setExpenseSheet] = useState<{ open: boolean; expense: GroupExpenseDto | null }>({ open: false, expense: null });
  const [payment, setPayment] = useState<{ open: boolean; suggestion: GroupSettlementSuggestionDto | null }>({ open: false, suggestion: null });
  const [editingGroup, setEditingGroup] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const navigate = useNavigate();
  const [removing, setRemoving] = useState<{ kind: 'expense' | 'payment'; id: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!removing || !id) return;
    setBusy(true);
    try {
      await api.delete(`/groups/${id}/${removing.kind === 'expense' ? 'expenses' : 'settlements'}/${removing.id}`);
      invalidate();
      toast.success(removing.kind === 'expense' ? t('groups.expenseRemoved') : t('groups.paymentRemoved'));
    } catch (err) {
      toast.error(t('common.couldNotRemoveThat'), errorMessage(err));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  }

  if (isLoading) return <Card><LoadingState rows={5} /></Card>;
  if (isError) return <Card><ErrorState titleAs="h1" error={error} onRetry={() => void refetch()} /></Card>;
  if (!group) return null;

  const nameOf = (personId: string | null, fallback?: string) =>
    personId === null ? t('groups.you') : fallback ?? group.memberNames[group.memberPersonIds.indexOf(personId)] ?? t('groups.member2');
  const me = summary?.positions.find((p) => p.personId === null);
  const suggestions = summary?.suggestions ?? [];
  const settlements = summary?.settlements ?? [];

  return (
    <div className="flex flex-col gap-5">
      <Link to="/groups" className="flex w-fit items-center gap-1.5 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink">
        <ArrowLeft aria-hidden className="size-3.5" />
        {t('groups.allGroups')}
      </Link>

      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-gold-soft text-gold-strong">
              <Users className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <h1 className="break-words text-lg font-semibold tracking-[-0.01em] text-ink">{group.name}</h1>
              <p className="mt-0.5 break-words text-[12.5px] text-ink-muted">{[t('groups.you'), ...group.memberNames].join(', ')}</p>
              <button
                type="button"
                onClick={() => setEditingGroup(true)}
                className="mt-1.5 flex items-center gap-1 text-[12.5px] font-medium text-gold-strong underline-offset-2 hover:underline"
              >
                <UserPlus aria-hidden className="size-3.5" />
                {t('groups.addPeople')}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
            <Button variant="secondary" leftIcon={<Pencil className="size-4" />} onClick={() => setEditingGroup(true)}>
              {t('groups.editGroup')}
            </Button>
            <Button variant="secondary" leftIcon={<HandCoins className="size-4" />} onClick={() => setPayment({ open: true, suggestion: null })}>
              {t('groups.recordPayment')}
            </Button>
            <Button variant="gold" className="col-span-2" leftIcon={<Plus className="size-4" />} onClick={() => setExpenseSheet({ open: true, expense: null })}>
              {t('groups.addExpense')}
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label={t('groups.totalSpent')}>
          <Money amountMinor={summary?.totalSpentMinor ?? 0} size="md" tone="neutral" compactDecimals />
        </StatTile>
        <StatTile label={t('groups.yourShare')}>
          <Money amountMinor={me?.shareMinor ?? 0} size="md" tone="neutral" compactDecimals />
        </StatTile>
        <StatTile label={me && me.netMinor < 0 ? t('groups.youOwe') : t('groups.youGetBack')}>
          <Money amountMinor={Math.abs(me?.netMinor ?? 0)} size="md" tone={!me || me.netMinor === 0 ? 'neutral' : me.netMinor > 0 ? 'positive' : 'negative'} compactDecimals />
        </StatTile>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader eyebrow={t('groups.balances')} title={t('groups.whoPaidAndWhoOwes')} />
          <div className="mt-3 hidden grid-cols-[1fr_6rem_6rem_8rem] gap-3 border-b border-line-faint pb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint sm:grid">
            <span>{t('common.members')}</span>
            <span className="text-right">{t('groups.paid')}</span>
            <span className="text-right">{t('groups.share')}</span>
            <span className="text-right">{t('groups.balance')}</span>
          </div>
          <ul className="flex flex-col divide-y divide-line-faint">
            {(summary?.positions ?? []).map((p) => (
              <li key={p.personId ?? 'me'} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 py-3 sm:grid-cols-[1fr_6rem_6rem_8rem]">
                <span className="min-w-0 truncate text-[13px] font-medium text-ink">
                  {p.personId ? (
                    <Link to={`/people/${p.personId}`} className="hover:underline">{nameOf(p.personId, p.personName)}</Link>
                  ) : (
                    nameOf(null)
                  )}
                </span>
                <span className="col-start-1 row-start-2 text-[11.5px] text-ink-muted sm:hidden">
                  {t('groups.paid')} <Money amountMinor={p.paidMinor} size="xs" tone="inherit" compactDecimals /> · {t('groups.share')}{' '}
                  <Money amountMinor={p.shareMinor} size="xs" tone="inherit" compactDecimals />
                </span>
                <Money amountMinor={p.paidMinor} size="sm" tone="neutral" compactDecimals className="hidden text-right sm:block" />
                <Money amountMinor={p.shareMinor} size="sm" tone="neutral" compactDecimals className="hidden text-right sm:block" />
                <span className="col-start-2 row-span-2 row-start-1 flex justify-end sm:col-start-auto sm:row-span-1 sm:row-start-auto">
                  <NetBadge netMinor={p.netMinor} />
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader eyebrow={t('groups.pending')} title={t('groups.settleUp')} />
          {suggestions.length === 0 ? (
            <div className="mt-4 flex items-center gap-2.5 rounded-md bg-positive-soft px-3.5 py-3 text-[13px] text-positive">
              <CheckCircle2 aria-hidden className="size-4 shrink-0" />
              {summary && summary.expenseCount > 0 ? t('groups.everyoneIsSettledUp') : t('groups.nothingToSettleYet')}
            </div>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {suggestions.map((s) => (
                <li key={`${s.fromPersonId ?? 'me'}-${s.toPersonId ?? 'me'}`} className="flex items-center gap-3 rounded-md border border-line-faint px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink">
                      <span className="truncate">{nameOf(s.fromPersonId, s.fromName)}</span>
                      <ArrowRight aria-label={t('groups.pays')} className="size-3.5 shrink-0 text-ink-faint" />
                      <span className="truncate">{nameOf(s.toPersonId, s.toName)}</span>
                    </p>
                    <Money amountMinor={s.amountMinor} size="sm" tone={s.toPersonId === null ? 'positive' : s.fromPersonId === null ? 'negative' : 'neutral'} compactDecimals />
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setPayment({ open: true, suggestion: s })}>
                    {t('groups.record')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11.5px] text-ink-muted">{t('groups.yourOwnBalancesStayPersonToPerson')}</p>
        </Card>
      </div>

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
            {expenses.map((expense) => {
              const sharedBy = expense.memberShares.length + (expense.mySplitMinor > 0 ? 1 : 0);
              return (
                <li key={expense.id} className="flex items-center gap-3 px-5 py-4 sm:px-6">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">{expense.description || t('groups.groupExpense')}</p>
                    <p className="mt-0.5 text-[11.5px] text-ink-muted">
                      {formatDate(expense.date)} · {t('groups.paidByName', { name: nameOf(expense.paidByPersonId, expense.paidByName) })} ·{' '}
                      {t.plural('groups.splitWays', sharedBy)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    <Money amountMinor={expense.totalAmountMinor} size="sm" tone="neutral" compactDecimals />
                    {expense.mySplitMinor > 0 && (
                      <span className="text-[11px] text-ink-muted">
                        {t('groups.yours')} <Money amountMinor={expense.mySplitMinor} size="xs" tone="inherit" compactDecimals />
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center">
                    <IconButton label={t('groups.editExpense')} onClick={() => setExpenseSheet({ open: true, expense })}>
                      <Pencil aria-hidden className="size-3.5" />
                    </IconButton>
                    <IconButton label={t('groups.removeExpense')} danger onClick={() => setRemoving({ kind: 'expense', id: expense.id })}>
                      <Trash2 aria-hidden className="size-3.5" />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {settlements.length > 0 && (
        <Card bare>
          <div className="p-5 pb-3 sm:p-6 sm:pb-3">
            <CardHeader eyebrow={t('groups.completed')} title={t('groups.paymentsMade')} />
          </div>
          <ul className="divide-y divide-line-faint">
            {settlements.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink">
                    <span className="truncate">{nameOf(s.fromPersonId, s.fromName)}</span>
                    <ArrowRight aria-label={t('groups.paid')} className="size-3.5 shrink-0 text-ink-faint" />
                    <span className="truncate">{nameOf(s.toPersonId, s.toName)}</span>
                  </p>
                  <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                    {[formatDate(s.date), s.accountName, s.note].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Money amountMinor={s.amountMinor} size="sm" tone="neutral" compactDecimals />
                <IconButton label={t('groups.removePayment')} danger onClick={() => setRemoving({ kind: 'payment', id: s.id })}>
                  <Trash2 aria-hidden className="size-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex justify-center pt-1 sm:justify-end">
        <Button variant="ghost" className="text-negative hover:bg-negative-soft" leftIcon={<Trash2 className="size-4" />} onClick={() => setDeletingGroup(true)}>
          {t('groups.deleteGroup')}
        </Button>
      </div>

      <AddGroupExpenseSheet
        group={group}
        open={expenseSheet.open}
        expense={expenseSheet.expense}
        onClose={() => setExpenseSheet({ open: false, expense: null })}
      />
      <GroupPaymentSheet
        group={group}
        open={payment.open}
        suggestion={payment.suggestion}
        suggestions={suggestions}
        onClose={() => setPayment({ open: false, suggestion: null })}
      />
      <GroupFormSheet open={editingGroup} group={group} onClose={() => setEditingGroup(false)} />
      <DeleteGroupDialog
        group={deletingGroup ? group : null}
        unsettled={suggestions.length > 0}
        onClose={() => setDeletingGroup(false)}
        onDeleted={() => navigate('/groups')}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        onCancel={() => setRemoving(null)}
        onConfirm={remove}
        title={removing?.kind === 'payment' ? t('groups.removeThisPayment') : t('groups.removeThisGroupExpense')}
        description={removing?.kind === 'payment' ? t('groups.removingAPaymentPutsItBack') : t('groups.deletesTheTransactionsItCreatedYour')}
        confirmLabel={t('common.remove')}
        tone="danger"
        busy={busy}
      />
    </div>
  );
}

function StatTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3.5 shadow-xs">
      <p className="label-eyebrow">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function NetBadge({ netMinor }: { netMinor: number }) {
  const t = useT();
  if (netMinor === 0) return <Badge tone="positive" eyebrow>{t('common.settled')}</Badge>;
  return (
    <span className={cn('flex flex-col items-end leading-tight', netMinor > 0 ? 'text-positive' : 'text-negative')}>
      <span className="text-[10.5px] font-medium uppercase tracking-[0.06em]">{netMinor > 0 ? t('groups.getsBack') : t('groups.owes')}</span>
      <Money amountMinor={Math.abs(netMinor)} size="sm" tone="inherit" weight="semibold" compactDecimals />
    </span>
  );
}

function IconButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'flex size-9 items-center justify-center rounded-sm text-ink-faint transition-colors',
        danger ? 'hover:text-negative' : 'hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
