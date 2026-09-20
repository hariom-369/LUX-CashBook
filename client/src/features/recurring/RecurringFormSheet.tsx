import { useEffect, useState } from 'react';
import { RECURRENCE_FREQUENCIES, TRANSACTION_META, TRANSACTION_TYPES, toDateKey, type RecurringTransactionDto, type TransactionType } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { useToast } from '../../components/ui/Toast';
import { useAccounts, useCategories } from '../../lib/queries';
import { useInvalidatePlanning } from '../../lib/queries3';
import { api, ApiRequestError, errorMessage } from '../../lib/api';

const POSTABLE_TYPES = TRANSACTION_TYPES.filter((t) => t === 'income' || t === 'expense' || t === 'transfer');

export function RecurringFormSheet({
  open,
  recurring,
  onClose,
}: {
  open: boolean;
  recurring: RecurringTransactionDto | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidatePlanning();
  const isEdit = Boolean(recurring);

  const [name, setName] = useState('');
  const [type, setType] = useState<TransactionType>('expense');
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
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
      setFrequency('monthly');
      setIntervalDays(30);
      setDayOfMonth('');
      setStartDate(toDateKey(new Date()));
      setEndDate('');
      setAutoPost(true);
    }
  }, [open, recurring, accounts]);

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
        frequency,
        intervalDays: frequency === 'custom' ? intervalDays : undefined,
        dayOfMonth: (frequency === 'monthly' || frequency === 'yearly') && dayOfMonth ? Number(dayOfMonth) : undefined,
        startDate: new Date(`${startDate}T12:00:00`).toISOString(),
        endDate: endDate ? new Date(`${endDate}T12:00:00`).toISOString() : null,
        autoPost,
      };
      if (recurring) {
        await api.patch(`/recurring/${recurring.id}`, payload);
        toast.success('Recurring entry updated');
      } else {
        await api.post('/recurring', payload);
        toast.success('Recurring entry created');
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
      title={isEdit ? 'Edit recurring entry' : 'New recurring entry'}
      size="md"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="gold" loading={busy} disabled={!name.trim() || !amountMinor || !accountId} onClick={() => void save()}>
            {isEdit ? 'Save changes' : 'Create'}
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

        <Field label="Name" required>
          {({ id }) => <Input id={id} autoFocus value={name} maxLength={60} placeholder="Rent" onChange={(event) => setName(event.target.value)} />}
        </Field>

        <Field label="Type" required>
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
                  {TRANSACTION_META[option].label}
                </button>
              ))}
            </div>
          )}
        </Field>

        <Field label="Amount" required>
          {({ id }) => <MoneyInput id={id} size="hero" value={amountMinor} onChange={setAmountMinor} />}
        </Field>

        <div className={cn('grid gap-4', type === 'transfer' && 'sm:grid-cols-2')}>
          <Field label={type === 'transfer' ? 'From account' : 'Account'} required>
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
            <Field label="To account" required>
              {({ id }) => (
                <Select id={id} value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>
                  <option value="">Choose…</option>
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
          <Field label="Category">
            {({ id }) => (
              <Select id={id} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                <option value="">Uncategorised</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <Field label="Frequency">
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
          <Field label="Repeat every (days)">
            {({ id }) => (
              <Input id={id} type="number" min={1} max={3650} value={intervalDays} onChange={(event) => setIntervalDays(Number(event.target.value))} />
            )}
          </Field>
        )}

        {(frequency === 'monthly' || frequency === 'yearly') && (
          <Field label="Day of month" hint="Optional — clamps to the month's last day when needed.">
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date">
            {({ id }) => <Input id={id} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />}
          </Field>
          <Field label="End date" hint="Optional">
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
            <span className="block text-[13px] font-medium text-ink">Post automatically</span>
            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-muted">
              {autoPost
                ? `Each ${meta.label.toLowerCase()} is recorded on schedule without confirmation.`
                : 'A reminder is raised instead — you confirm each occurrence yourself.'}
            </span>
          </span>
        </label>
      </form>
    </Sheet>
  );
}
