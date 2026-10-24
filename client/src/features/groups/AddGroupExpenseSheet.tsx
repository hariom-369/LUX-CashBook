import { useEffect, useMemo, useState } from 'react';
import {
  GROUP_SPLIT_METHODS,
  allocateProportionally,
  toDateKey,
  type ExpenseGroupDto,
  type GroupExpenseDto,
  type GroupSplitMethod,
} from '@khata/shared';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { Money } from '../../components/ui/Money';
import { useToast } from '../../components/ui/Toast';
import { useAccounts, useCategories } from '../../lib/queries';
import { useInvalidateGroup } from '../../lib/queries3';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useT, msg, type MessageRef } from '../../i18n';
import { useOfflineCreate } from '../../hooks/useOfflineCreate';
import { cn } from '../../lib/cn';

const METHOD_LABEL: Record<GroupSplitMethod, MessageRef> = {
  equal: msg('groups.equally'),
  exact: msg('groups.exactAmounts'),
  percentage: msg('groups.byPercentage'),
  shares: msg('groups.byShares'),
};

/** `'me'` is you; anything else is a member's person id. */
type ParticipantId = 'me' | string;

const toParticipant = (personId: string | null): ParticipantId => personId ?? 'me';

/**
 * Add or edit one group expense — who paid, how much, and how it splits.
 * Anyone left unticked is excluded from this expense. The preview beside each
 * name is computed exactly as the server will split it, so what you see is
 * what gets recorded.
 */
export function AddGroupExpenseSheet({
  group,
  open,
  onClose,
  expense,
}: {
  group: ExpenseGroupDto;
  open: boolean;
  onClose: () => void;
  /** Present when editing. */
  expense?: GroupExpenseDto | null;
}) {
  const t = useT();
  const toast = useToast();
  const createOrQueue = useOfflineCreate();
  const invalidate = useInvalidateGroup(group.id);
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories('expense');

  const [description, setDescription] = useState('');
  const [date, setDate] = useState(toDateKey(new Date()));
  const [paidBy, setPaidBy] = useState<ParticipantId>('me');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [splitMethod, setSplitMethod] = useState<GroupSplitMethod>('equal');
  const [totalMinor, setTotalMinor] = useState<number | null>(null);
  const [included, setIncluded] = useState<Record<ParticipantId, boolean>>({ me: true });
  const [values, setValues] = useState<Record<ParticipantId, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The first account's id, not the array: `useAccounts()` hands back a fresh array while loading, which would re-run the reset below on every render.
  const defaultAccountId = accounts[0]?.id ?? '';
  const participantIds: ParticipantId[] = ['me', ...group.memberPersonIds];
  const nameOf = (id: ParticipantId) =>
    id === 'me' ? t('groups.you') : group.memberNames[group.memberPersonIds.indexOf(id)] ?? t('groups.member2');

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (expense) {
      setDescription(expense.description);
      setDate(toDateKey(new Date(expense.date)));
      setPaidBy(toParticipant(expense.paidByPersonId));
      setAccountId(expense.accountId ?? defaultAccountId);
      setCategoryId(expense.categoryId ?? '');
      setTotalMinor(expense.totalAmountMinor);
      if (expense.splitInputs.length > 0) {
        setSplitMethod(expense.splitMethod);
        setIncluded(Object.fromEntries(expense.splitInputs.map((i) => [toParticipant(i.personId), true])));
        setValues(Object.fromEntries(expense.splitInputs.map((i) => [toParticipant(i.personId), i.value ?? 0])));
      } else {
        // Recorded before the entered split was kept: edit it as the exact amounts it came to.
        const shares: Array<[ParticipantId, number]> = [
          ...(expense.mySplitMinor > 0 ? [['me', expense.mySplitMinor] as [ParticipantId, number]] : []),
          ...expense.memberShares.map((s) => [s.personId, s.amountMinor] as [ParticipantId, number]),
        ];
        setSplitMethod('exact');
        setIncluded(Object.fromEntries(shares.map(([id]) => [id, true])));
        setValues(Object.fromEntries(shares));
      }
      return;
    }
    setDescription('');
    setDate(toDateKey(new Date()));
    setPaidBy('me');
    setCategoryId('');
    setSplitMethod('equal');
    setTotalMinor(null);
    setIncluded({ me: true, ...Object.fromEntries(group.memberPersonIds.map((id) => [id, true])) });
    setValues({});
    setAccountId((current) => current || defaultAccountId);
  }, [open, expense, group.memberPersonIds, defaultAccountId]);

  const activeIds = participantIds.filter((id) => included[id]);

  /** Each included participant's share, exactly as the server will compute it. */
  const shareById = useMemo(() => {
    if (!totalMinor || activeIds.length === 0) return {} as Record<ParticipantId, number>;
    const shares =
      splitMethod === 'exact'
        ? activeIds.map((id) => values[id] ?? 0)
        : allocateProportionally(totalMinor, activeIds.map((id) => (splitMethod === 'equal' ? 1 : values[id] ?? 0)));
    return Object.fromEntries(activeIds.map((id, i) => [id, shares[i] ?? 0])) as Record<ParticipantId, number>;
  }, [totalMinor, activeIds.join(','), splitMethod, values]); // eslint-disable-line react-hooks/exhaustive-deps

  const exactSum = activeIds.reduce((sum, id) => sum + (values[id] ?? 0), 0);
  const percentSum = activeIds.reduce((sum, id) => sum + (values[id] ?? 0), 0);
  const shareCount = activeIds.reduce((sum, id) => sum + (values[id] ?? 0), 0);
  const myShare = shareById.me ?? 0;

  // Your money is involved if you paid, or if you owe the payer a share.
  const needsAccount = paidBy === 'me' || (included.me && myShare > 0);
  const splitValid =
    splitMethod === 'equal' ||
    (splitMethod === 'exact' && exactSum === totalMinor) ||
    (splitMethod === 'percentage' && Math.abs(percentSum - 100) < 1e-6) ||
    (splitMethod === 'shares' && shareCount > 0);
  const canSubmit = Boolean(totalMinor && activeIds.length > 0 && splitValid && (!needsAccount || accountId));

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    const body = {
      description,
      date: new Date(`${date}T12:00:00`).toISOString(),
      accountId: needsAccount ? accountId : null,
      categoryId: categoryId || undefined,
      splitMethod,
      totalAmountMinor: totalMinor,
      paidByPersonId: paidBy === 'me' ? null : paidBy,
      participants: activeIds.map((id) => ({
        personId: id === 'me' ? null : id,
        value: splitMethod === 'equal' ? undefined : values[id] ?? 0,
      })),
    };
    try {
      if (expense) {
        await api.put(`/groups/${group.id}/expenses/${expense.id}`, body, { idempotencyKey: crypto.randomUUID() });
        invalidate();
        toast.success(t('groups.expenseUpdated'));
      } else {
        const created = await createOrQueue(`/groups/${group.id}/expenses`, body);
        invalidate();
        if (created) toast.success(t('groups.expenseAdded'));
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const valueLabel = splitMethod === 'exact' ? t('reminders.form.amount') : splitMethod === 'percentage' ? t('groups.percentage') : t('groups.shares');

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={expense ? t('groups.editGroupExpense') : t('groups.addAGroupExpense')}
      size="md"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={!canSubmit} onClick={() => void submit()}>
            {expense ? t('groups.saveChanges') : t('groups.addExpense')}
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

        <Field label={t('groups.whatWasItFor')}>
          {({ id }) => <Input id={id} autoFocus value={description} maxLength={200} placeholder={t('groups.dinner')} onChange={(e) => setDescription(e.target.value)} />}
        </Field>

        <Field label={t('groups.totalAmountPaid')} required>
          {({ id }) => <MoneyInput id={id} size="hero" value={totalMinor} onChange={setTotalMinor} />}
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('groups.paidBy')} required>
            {({ id }) => (
              <Select id={id} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                {participantIds.map((pid) => (
                  <option key={pid} value={pid}>{nameOf(pid)}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('common.date')}>
            {({ id }) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
        </div>

        {needsAccount && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={paidBy === 'me' ? t('groups.paidFrom') : t('groups.recordYourShareIn')}
              hint={paidBy === 'me' ? undefined : t('groups.theirPaymentLeavesThisBalanceUnchanged', { name: nameOf(paidBy) })}
              required
            >
              {({ id }) => (
                <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </Select>
              )}
            </Field>
            {myShare > 0 && (
              <Field label={t('common.category')} hint={t('groups.appliesToYourOwnShare')}>
                {({ id }) => (
                  <Select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">{t('common.uncategorised')}</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </div>
        )}

        <Field label={t('groups.split')}>
          {({ id }) => (
            <div id={id} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {GROUP_SPLIT_METHODS.map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setSplitMethod(method)}
                  aria-pressed={splitMethod === method}
                  className={cn(
                    'h-10 rounded-md border text-[12px] font-medium transition-colors',
                    splitMethod === method ? 'border-gold bg-gold-soft text-gold-strong' : 'border-line bg-surface text-ink-secondary hover:bg-sunken',
                  )}
                >
                  {t(METHOD_LABEL[method].key)}
                </button>
              ))}
            </div>
          )}
        </Field>

        <fieldset className="rounded-md border border-line-faint">
          <legend className="sr-only">{t('groups.whoSharesThis')}</legend>
          <p className="border-b border-line-faint px-3.5 py-2 text-[11.5px] text-ink-muted">{t('groups.untickAnyoneNotSharingThis')}</p>
          <ul className="divide-y divide-line-faint">
            {participantIds.map((pid) => {
              const on = included[pid] ?? false;
              return (
                <li key={pid} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2">
                  <label className="flex min-w-0 flex-1 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => setIncluded((cur) => ({ ...cur, [pid]: e.target.checked }))}
                      className="size-4 shrink-0 rounded-sm border-line text-gold focus:ring-gold"
                    />
                    <span className={cn('min-w-0 truncate text-[13px]', on ? 'text-ink' : 'text-ink-faint line-through')}>{nameOf(pid)}</span>
                  </label>
                  {on && splitMethod === 'exact' && (
                    <MoneyInput
                      value={values[pid] ?? null}
                      onChange={(v) => setValues((cur) => ({ ...cur, [pid]: v ?? 0 }))}
                      className="w-32"
                      aria-label={t('groups.splitFor', { method: valueLabel, name: nameOf(pid) })}
                    />
                  )}
                  {on && (splitMethod === 'percentage' || splitMethod === 'shares') && (
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={splitMethod === 'percentage' ? '0.01' : '1'}
                      aria-label={t('groups.splitFor', { method: valueLabel, name: nameOf(pid) })}
                      value={values[pid] ?? ''}
                      onChange={(e) => setValues((cur) => ({ ...cur, [pid]: Math.max(0, Number(e.target.value) || 0) }))}
                      className="w-24"
                    />
                  )}
                  {on && splitMethod !== 'exact' && totalMinor ? (
                    <Money amountMinor={shareById[pid] ?? 0} size="sm" tone="neutral" compactDecimals className="w-24 text-right" />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </fieldset>

        {totalMinor !== null && splitMethod === 'exact' && (
          <p className={cn('text-[11.5px]', exactSum === totalMinor ? 'text-ink-muted' : 'text-negative')}>
            {t('groups.enteredSoFar')} <Money amountMinor={exactSum} size="xs" tone="inherit" compactDecimals /> {t('common.of')}{' '}
            <Money amountMinor={totalMinor} size="xs" tone="inherit" compactDecimals />
          </p>
        )}
        {splitMethod === 'percentage' && (
          <p className={cn('text-[11.5px]', Math.abs(percentSum - 100) < 1e-6 ? 'text-ink-muted' : 'text-negative')}>
            {t('groups.percentAddsUpTo', { percent: String(Math.round(percentSum * 100) / 100) })}
          </p>
        )}
        {paidBy !== 'me' && !included.me && (
          <p className="text-[11.5px] text-ink-muted">{t('groups.youAreNotInThisOne')}</p>
        )}
      </form>
    </Sheet>
  );
}
