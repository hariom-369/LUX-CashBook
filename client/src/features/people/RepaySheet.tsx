import { useEffect, useState } from 'react';
import { formatMoney, toDateKey } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { useToast } from '../../components/ui/Toast';
import { useAccounts, useInvalidateLedger } from '../../lib/queries';
import { useCurrency } from '../../hooks/useCurrency';
import { api, ApiRequestError, errorMessage } from '../../lib/api';

/**
 * Record a partial or full repayment (§16).
 *
 * The direction defaults from the person's current balance — if they owe you, a
 * repayment is money coming in — but stays overridable, because in the real world
 * a person can pay you back the ₹3,000 they owed while you separately owe them for
 * something else, and forcing the "obvious" direction would misrecord it.
 */
export function RepaySheet({
  personId,
  personName,
  personBalanceMinor,
  open,
  onClose,
}: {
  personId: string;
  personName: string;
  personBalanceMinor: number;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateLedger();
  const currency = useCurrency();
  const { data: accounts = [] } = useAccounts();

  const [direction, setDirection] = useState<'received' | 'given'>(
    personBalanceMinor >= 0 ? 'received' : 'given',
  );
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(toDateKey(new Date()));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDirection(personBalanceMinor >= 0 ? 'received' : 'given');
    setAmountMinor(null);
    setDate(toDateKey(new Date()));
    setNote('');
    setError(null);
    setAccountId((current) => current || accounts[0]?.id || '');
  }, [open, personBalanceMinor, accounts]);

  if (!open) return null;
  const outstanding = Math.abs(personBalanceMinor);

  async function submit() {
    if (!amountMinor || amountMinor <= 0 || !accountId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/people/${personId}/repay`, {
        amountMinor,
        accountId,
        date: new Date(`${date}T12:00:00`).toISOString(),
        note: note.trim() || undefined,
        direction,
        idempotencyKey: `repay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      });
      invalidate();
      toast.success('Repayment recorded');
      onClose();
    } catch (err) {
      // The API's OVER_REPAYMENT message already names the outstanding amount.
      setError(err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Repayment with ${personName}`}
      description={
        outstanding > 0
          ? `${formatMoney(outstanding, { currency, compactDecimals: true })} outstanding.`
          : undefined
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
            Record repayment
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

        <Field label="Direction">
          {({ id }) => (
            <div id={id} className="grid grid-cols-2 gap-2">
              {(
                [
                  ['received', 'They paid me'],
                  ['given', 'I paid them'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDirection(value)}
                  aria-pressed={direction === value}
                  className={cn(
                    'h-11 rounded-md border text-[13px] font-medium transition-colors',
                    direction === value
                      ? 'border-gold bg-gold-soft text-gold-strong'
                      : 'border-line bg-surface text-ink-secondary hover:bg-sunken',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </Field>

        <Field label="Amount" hint={outstanding > 0 ? 'A partial amount is fine — the rest stays outstanding.' : undefined}>
          {({ id }) => <MoneyInput id={id} size="hero" autoFocus value={amountMinor} onChange={setAmountMinor} />}
        </Field>

        <Field label={direction === 'received' ? 'Into account' : 'From account'} required>
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

        <Field label="Note" hint="Optional">
          {({ id }) => <Input id={id} value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} />}
        </Field>
      </form>
    </Sheet>
  );
}
