import { useEffect, useState } from 'react';
import {
  BILL_KINDS,
  BILL_KIND_LABELS,
  RECURRENCE_FREQUENCIES,
  TRANSACTION_META,
  TRANSACTION_TYPES,
  toDateKey,
  type BillKind,
  type RecurringTransactionDto,
  type TransactionType,
} from '@khata/shared';
import { cn } from '../../lib/cn';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { useToast } from '../../components/ui/Toast';
import { useAccounts, useCategories, usePayees } from '../../lib/queries';
import { useInvalidatePlanning } from '../../lib/queries3';
import { ApiRequestError, errorMessage } from '../../lib/api';
import { useOfflinePatch } from '../../hooks/useOfflinePatch';
import { useT } from '../../i18n';
import { useOfflineCreate } from '../../hooks/useOfflineCreate';

const POSTABLE_TYPES = TRANSACTION_TYPES.filter((t) => t === 'income' || t === 'expense' || t === 'transfer');

export function RecurringFormSheet({
  open,
  recurring,
  defaultBillKind,
  onClose,
}: {
  open: boolean;
  recurring: RecurringTransactionDto | null;
  /** Pre-selects a bill kind when opened from the Bills & Subscriptions centre. */
  defaultBillKind?: BillKind;
  onClose: () => void;
}) {
  const tr = useT();
  const toast = useToast();
  const createOrQueue = useOfflineCreate();
  const patchOrQueue = useOfflinePatch();
  const invalidate = useInvalidatePlanning();
  const isEdit = Boolean(recurring);

  const [name, setName] = useState('');
  const [type, setType] = useState<TransactionType>('expense');
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [payeeId, setPayeeId] = useState('');
  const [billKind, setBillKind] = useState<BillKind | ''>('');
  const [frequency, setFrequency] = useState<(typeof RECURRENCE_FREQUENCIES)[number]>('monthly');
  const [intervalDays, setIntervalDays] = useState(30);
  const [dayOfMonth, setDayOfMonth] = useState<number | ''>('');
  const [startDate, setStartDate] = useState(toDateKey(new Date()));
  const [endDate, setEndDate] = useState('');
  const [autoPost, setAutoPost] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories(type === 'income' ? 'income' : 'expense');
  const { data: payees = [] } = usePayees();
  const meta = TRANSACTION_META[type];

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (recurring) {
      setName(recurring.name);
      setType(recurring.type);
      setAmountMinor(recurring.amountMinor);
      setAccountId(recurring.accountId);
      setToAccountId(recurring.toAccountId ?? '');
      setCategoryId(recurring.categoryId ?? '');
      setPayeeId(recurring.payeeId ?? '');
      setBillKind(recurring.billKind ?? '');
      setFrequency(recurring.frequency);
      setIntervalDays(recurring.intervalDays ?? 30);
      setDayOfMonth(recurring.dayOfMonth ?? '');
      setStartDate(toDateKey(new Date(recurring.startDate)));
      setEndDate(recurring.endDate ? toDateKey(new Date(recurring.endDate)) : '');
      setAutoPost(recurring.autoPost);
    } else {
      setName('');
      setType('expense');
      setAmountMinor(null);
      setAccountId((current) => current || accounts[0]?.id || '');
      setToAccountId('');
      setCategoryId('');
      setPayeeId('');
      setBillKind(defaultBillKind ?? '');
      setFrequency('monthly');
      setIntervalDays(30);
      setDayOfMonth('');
      setStartDate(toDateKey(new Date()));
      setEndDate('');
      setAutoPost(true);
    }
  }, [open, recurring, accounts, defaultBillKind]);

  async function save() {
    if (!name.trim() || !amountMinor || amountMinor <= 0 || !accountId) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        type,
        amountMinor,
        accountId,
        toAccountId: type === 'transfer' ? toAccountId : undefined,
        categoryId: type === 'transfer' ? undefined : categoryId || undefined,
        payeeId: type === 'transfer' ? undefined : payeeId || undefined,
        billKind: type === 'expense' && billKind ? billKind : null,
        frequency,
        intervalDays: frequency === 'custom' ? intervalDays : undefined,
        dayOfMonth: (frequency === 'monthly' || frequency === 'yearly') && dayOfMonth ? Number(dayOfMonth) : undefined,
        startDate: new Date(`${startDate}T12:00:00`).toISOString(),
        endDate: endDate ? new Date(`${endDate}T12:00:00`).toISOString() : null,
        autoPost,
      };
      if (recurring) {
        await patchOrQueue(`/recurring/${recurring.id}`, { ...payload, rev: recurring.rev });
        toast.success(tr('recurring.recurringEntryUpdated'));
      } else {
        if (await createOrQueue('/recurring', payload)) toast.success(tr('recurring.recurringEntryCreated'));
      }
      invalidate();
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
      title={isEdit ? tr('recurring.editRecurringEntry') : tr('recurring.newRecurringEntry')}
      size="md"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {tr('common.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={!name.trim() || !amountMinor || !accountId} onClick={() => void save()}>
            {isEdit ? tr('common.saveChanges') : tr('recurring.create')}
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

        <Field label={tr('common.name')} required>
          {({ id }) => <Input id={id} autoFocus value={name} maxLength={60} placeholder={tr('reminders.type.rent')} onChange={(event) => setName(event.target.value)} />}
        </Field>

        <Field label={tr('reminders.form.type')} required>
          {({ id }) => (
            <div id={id} className="grid grid-cols-3 gap-2">
              {POSTABLE_TYPES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setType(option)}
                  disabled={isEdit}
                  aria-pressed={type === option}
                  className={cn(
                    'h-10 rounded-md border text-[12.5px] font-medium transition-colors disabled:opacity-50',
                    type === option ? 'border-gold bg-gold-soft text-gold-strong' : 'border-line bg-surface text-ink-secondary hover:bg-sunken',
                  )}
                >
                  {tr.label('txType', option, TRANSACTION_META[option].label)}
                </button>
              ))}
            </div>
          )}
        </Field>

        <Field label={tr('reminders.form.amount')} required>
          {({ id }) => <MoneyInput id={id} size="hero" value={amountMinor} onChange={setAmountMinor} />}
        </Field>

        <div className={cn('grid grid-cols-1 gap-4', type === 'transfer' && 'sm:grid-cols-2')}>
          <Field label={type === 'transfer' ? tr('goals.fromAccount') : tr('common.account')} required>
            {({ id }) => (
              <Select id={id} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {type === 'transfer' && (
            <Field label={tr('common.toAccount')} required>
              {({ id }) => (
                <Select id={id} value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>
                  <option value="">{tr('common.choose')}</option>
                  {accounts.filter((a) => a.id !== accountId).map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>

        {type !== 'transfer' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={tr('common.category')}>
              {({ id }) => (
                <Select id={id} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                  <option value="">{tr('common.uncategorised')}</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={tr('common.payee')} hint={tr('common.optional')}>
              {({ id }) => (
                <Select id={id} value={payeeId} onChange={(event) => setPayeeId(event.target.value)}>
                  <option value="">{tr('common.none')}</option>
                  {payees.map((payee) => (
                    <option key={payee.id} value={payee.id}>
                      {payee.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}

        {type === 'expense' && (
          <Field label={tr('recurring.billType')} hint={tr('recurring.groupsThisInTheBillsSubscriptions')}>
            {({ id }) => (
              <Select id={id} value={billKind} onChange={(event) => setBillKind(event.target.value as BillKind | '')}>
                <option value="">{tr('recurring.notABill')}</option>
                {BILL_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {tr.label('billKind', kind, BILL_KIND_LABELS[kind])}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <Field label={tr('recurring.frequency')}>
          {({ id }) => (
            <Select id={id} value={frequency} onChange={(event) => setFrequency(event.target.value as typeof frequency)} disabled={isEdit}>
              {RECURRENCE_FREQUENCIES.map((option) => (
                <option key={option} value={option}>
                  {option[0]!.toUpperCase() + option.slice(1)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {frequency === 'custom' && (
          <Field label={tr('recurring.repeatEveryDays')}>
            {({ id }) => (
              <Input id={id} type="number" min={1} max={3650} value={intervalDays} onChange={(event) => setIntervalDays(Number(event.target.value))} />
            )}
          </Field>
        )}

        {(frequency === 'monthly' || frequency === 'yearly') && (
          <Field label={tr('recurring.dayOfMonth')} hint={tr('recurring.optionalClampsToTheMonthS')}>
            {({ id }) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={31}
                value={dayOfMonth}
                onChange={(event) => setDayOfMonth(event.target.value ? Number(event.target.value) : '')}
              />
            )}
          </Field>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={tr('recurring.startDate')}>
            {({ id }) => <Input id={id} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />}
          </Field>
          <Field label={tr('recurring.endDate')} hint={tr('common.optional')}>
            {({ id }) => <Input id={id} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />}
          </Field>
        </div>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={autoPost}
            onChange={(event) => setAutoPost(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 rounded-sm border-line text-gold focus:ring-gold"
          />
          <span>
            <span className="block text-[13px] font-medium text-ink">{tr('recurring.postAutomatically')}</span>
            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-muted">
              {autoPost
                ? tr('recurring.eachRecordedOnSchedule', { type: tr.label('txType', type, meta.label).toLowerCase() })
                : 'A reminder is raised instead — you confirm each occurrence yourself.'}
            </span>
          </span>
        </label>
      </form>
    </Sheet>
  );
}
