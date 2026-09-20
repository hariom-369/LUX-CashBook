import { useEffect, useState } from 'react';
import { toDateKey } from '@khata/shared';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { useToast } from '../../components/ui/Toast';
import { useAccounts, useInvalidateLedger } from '../../lib/queries';
import { api, ApiRequestError, errorMessage } from '../../lib/api';

/**
 * Give or take money against a person's ledger (§14, §15).
 *
 * Both directions share one form because the fields are identical — amount,
 * account, date, optional due date and note — and only the verb and the endpoint
 * differ. Splitting them into two components would just be the same JSX twice.
 */
export function LendBorrowSheet({
  personId,
  personName,
  mode,
  onClose,
}: {
  personId: string;
  personName: string;
  mode: 'lend' | 'borrow' | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateLedger();
  const { data: accounts = [] } = useAccounts();

  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(toDateKey(new Date()));
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mode) return;
    setAmountMinor(null);
    setDate(toDateKey(new Date()));
    setDueDate('');
    setNote('');
    setError(null);
    setAccountId((current) => current || accounts[0]?.id || '');
  }, [mode, accounts]);

  if (!mode) return null;
  const isLend = mode === 'lend';

  async function submit() {
    if (!amountMinor || amountMinor <= 0 || !accountId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/people/${personId}/${mode}`, {
        amountMinor,
        accountId,
        date: new Date(`${date}T12:00:00`).toISOString(),
        dueDate: dueDate ? new Date(`${dueDate}T12:00:00`).toISOString() : undefined,
        note: note.trim() || undefined,
        idempotencyKey: `${mode}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      });
      invalidate();
      toast.success(isLend ? 'Recorded as lent' : 'Recorded as borrowed');
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={isLend ? `Give money to ${personName}` : `Borrow from ${personName}`}
      description={
        isLend
          ? 'This leaves the account you choose and increases what they owe you.'
          : 'This enters the account you choose and increases what you owe them.'
      }
      size="sm"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="gold"
            loading={busy}
            disabled={!amountMinor || amountMinor <= 0 || !accountId}
            onClick={() => void submit()}
          >
            {isLend ? 'Record loan' : 'Record borrowing'}
          </Button>
        </div>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4 pb-2"
      >
        {error && (
          <div
            role="alert"
            className="rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] leading-relaxed text-negative"
          >
            {error}
          </div>
        )}

        <Field label="Amount" required>
          {({ id }) => <MoneyInput id={id} size="hero" autoFocus value={amountMinor} onChange={setAmountMinor} />}
        </Field>

        <Field label={isLend ? 'From account' : 'To account'} required>
          {({ id }) => (
            <select
              id={id}
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className="h-11 w-full rounded-md border border-line bg-sunken px-3.5 text-[15px] text-ink focus:border-gold focus:bg-surface focus:outline-none focus:ring-4 focus:ring-[--k-gold-ring]"
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Date">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={date}
                max={toDateKey(new Date())}
                onChange={(event) => setDate(event.target.value)}
              />
            )}
          </Field>
          <Field label="Due date" hint="Optional">
            {({ id }) => <Input id={id} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />}
          </Field>
        </div>

        <Field label="Note" hint="Optional">
          {({ id }) => (
            <Input
              id={id}
              value={note}
              maxLength={200}
              placeholder={isLend ? 'For rent' : 'For tickets'}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
      </form>
    </Sheet>
  );
}
