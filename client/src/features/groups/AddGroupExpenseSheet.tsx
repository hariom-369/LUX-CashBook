import { useEffect, useState } from 'react';
import { GROUP_SPLIT_METHODS, allocateProportionally, toDateKey, type ExpenseGroupDto, type GroupSplitMethod } from '@khata/shared';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { Money } from '../../components/ui/Money';
import { useToast } from '../../components/ui/Toast';
import { useAccounts, useCategories } from '../../lib/queries';
import { useInvalidateGroup } from '../../lib/queries3';
import { ApiRequestError, errorMessage } from '../../lib/api';
import { useT, msg, type MessageRef } from '../../i18n';
import { useOfflineCreate } from '../../hooks/useOfflineCreate';

const METHOD_LABEL: Record<GroupSplitMethod, MessageRef> = {
  equal: msg('groups.equally'),
  exact: msg('groups.exactAmounts'),
  percentage: msg('groups.byPercentage'),
  shares: msg('groups.byShares'),
};

type ParticipantId = 'me' | string;

export function AddGroupExpenseSheet({ group, open, onClose }: { group: ExpenseGroupDto; open: boolean; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const createOrQueue = useOfflineCreate();
  const invalidate = useInvalidateGroup(group.id);
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories('expense');

  const [description, setDescription] = useState('');
  const [date, setDate] = useState(toDateKey(new Date()));
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [splitMethod, setSplitMethod] = useState<GroupSplitMethod>('equal');
  const [totalMinor, setTotalMinor] = useState<number | null>(null);
  const [included, setIncluded] = useState<Record<ParticipantId, boolean>>({ me: true });
  const [values, setValues] = useState<Record<ParticipantId, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const participantIds: ParticipantId[] = ['me', ...group.memberPersonIds];
  const nameOf = (id: ParticipantId) => (id === 'me' ? 'You' : group.memberNames[group.memberPersonIds.indexOf(id)] ?? t('groups.member2'));

  useEffect(() => {
    if (!open) return;
    setDescription('');
    setDate(toDateKey(new Date()));
    setCategoryId('');
    setSplitMethod('equal');
    setTotalMinor(null);
    setIncluded({ me: true, ...Object.fromEntries(group.memberPersonIds.map((id) => [id, true])) });
    setValues({});
    setError(null);
    setAccountId((current) => current || accounts[0]?.id || '');
  }, [open, group.memberPersonIds, accounts]);

  const activeIds = participantIds.filter((id) => included[id]);
  const previewShares =
    totalMinor && activeIds.length > 0
      ? allocateProportionally(
          totalMinor,
          activeIds.map((id) => (splitMethod === 'equal' ? 1 : splitMethod === 'exact' ? 0 : values[id] ?? 0)),
        )
      : [];
  const previewByIdEqualOrWeighted = Object.fromEntries(activeIds.map((id, i) => [id, previewShares[i] ?? 0]));
  const exactSum = activeIds.reduce((sum, id) => sum + (values[id] ?? 0), 0);

  async function submit() {
    if (!totalMinor || !accountId || activeIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createOrQueue(`/groups/${group.id}/expenses`, {
        description,
        date: new Date(`${date}T12:00:00`).toISOString(),
        accountId,
        categoryId: categoryId || undefined,
        splitMethod,
        totalAmountMinor: totalMinor,
        participants: activeIds.map((id) => ({
          personId: id === 'me' ? null : id,
          value: splitMethod === 'equal' ? undefined : values[id] ?? 0,
        })),
      });
      invalidate();
      if (created) toast.success(t('groups.expenseAdded'));
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    Boolean(totalMinor && accountId && activeIds.length > 0) &&
    (splitMethod !== 'exact' || exactSum === totalMinor);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('groups.addAGroupExpense')}
      size="md"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={!canSubmit} onClick={() => void submit()}>
            {t('groups.addExpense')}
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
          <Field label={t('groups.paidFrom')} required>
            {({ id }) => (
              <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            )}
          </Field>
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
        </div>

        <Field label={t('common.date')}>
          {({ id }) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>

        <Field label={t('groups.split')}>
          {({ id }) => (
            <div id={id} className="grid grid-cols-4 gap-2">
              {GROUP_SPLIT_METHODS.map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setSplitMethod(method)}
                  aria-pressed={splitMethod === method}
                  className={`h-10 rounded-md border text-[11.5px] font-medium transition-colors ${splitMethod === method ? 'border-gold bg-gold-soft text-gold-strong' : 'border-line bg-surface text-ink-secondary hover:bg-sunken'}`}
                >
                  {t(METHOD_LABEL[method].key)}
                </button>
              ))}
            </div>
          )}
        </Field>

        <ul className="flex flex-col gap-2">
          {participantIds.map((id) => (
            <li key={id} className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={included[id] ?? false}
                onChange={(e) => setIncluded((cur) => ({ ...cur, [id]: e.target.checked }))}
                className="size-4 shrink-0 rounded-sm border-line text-gold focus:ring-gold"
              />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{nameOf(id)}</span>
              {included[id] && splitMethod !== 'equal' && (
                <Input
                  type="number"
                  min={0}
                  aria-label={t('groups.splitFor', { method: splitMethod === 'exact' ? t('reminders.form.amount') : splitMethod === 'percentage' ? t('groups.percentage') : t('groups.shares'), name: nameOf(id) })}
                  value={splitMethod === 'exact' ? (values[id] ? values[id] / 100 : '') : values[id] ?? ''}
                  onChange={(e) => {
                    const raw = Number(e.target.value) || 0;
                    setValues((cur) => ({ ...cur, [id]: splitMethod === 'exact' ? Math.round(raw * 100) : raw }));
                  }}
                  className="w-24"
                />
              )}
              {included[id] && splitMethod === 'equal' && previewByIdEqualOrWeighted[id] !== undefined && (
                <Money amountMinor={previewByIdEqualOrWeighted[id]} size="sm" tone="neutral" compactDecimals />
              )}
              {included[id] && splitMethod === 'percentage' && previewByIdEqualOrWeighted[id] !== undefined && (
                <Money amountMinor={previewByIdEqualOrWeighted[id]} size="xs" tone="neutral" compactDecimals />
              )}
            </li>
          ))}
        </ul>

        {splitMethod === 'exact' && totalMinor !== null && (
          <p className="text-[11.5px] text-ink-muted">
            {t('groups.enteredSoFar')} <Money amountMinor={exactSum} size="xs" tone={exactSum === totalMinor ? 'neutral' : 'negative'} compactDecimals /> {t('common.of')}{' '}
            <Money amountMinor={totalMinor} size="xs" tone="neutral" compactDecimals />
          </p>
        )}
      </form>
    </Sheet>
  );
}
