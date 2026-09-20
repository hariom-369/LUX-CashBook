import { useEffect, useState } from 'react';
import { formatMoney, toDateKey } from '@khata/shared';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { Money } from '../../components/ui/Money';
import { useToast } from '../../components/ui/Toast';
import { useAccounts, useInvalidateLedger } from '../../lib/queries';
import { useCurrency } from '../../hooks/useCurrency';
import { api, errorMessage } from '../../lib/api';

/**
 * Settle a person's whole outstanding balance in one entry (§17).
 *
 * The amount is fixed — it is whatever is outstanding — so the only decisions left
 * are which account and when. That is deliberate: a settle button that let the
 * amount drift would just be a repayment with an intimidating name.
 */
export function SettleDialog({
  personId,
  personName,
  outstandingMinor,
  open,
  onClose,
}: {
  personId: string;
  personName: string;
  outstandingMinor: number;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateLedger();
  const currency = useCurrency();
  const { data: accounts = [] } = useAccounts();

  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(toDateKey(new Date()));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDate(toDateKey(new Date()));
    setNote('');
    setError(null);
    setAccountId((current) => current || accounts[0]?.id || '');
  }, [open, accounts]);

  if (!open) return null;
  const amount = Math.abs(outstandingMinor);
  const willReceive = outstandingMinor > 0;

  async function submit() {
    if (!accountId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/people/${personId}/settle`, {
        accountId,
        date: new Date(`${date}T12:00:00`).toISOString(),
        note: note.trim() || undefined,
      });
      invalidate();
      toast.success('Account settled', `${personName}'s balance is now zero.`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Settle with ${personName}`}
      description="Records one repayment for the full outstanding amount and closes the balance to zero. Every past entry stays in the ledger."
      size="sm"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="gold" loading={busy} disabled={!accountId} onClick={() => void submit()}>
            Settle account
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

        <div className="rounded-lg border border-line bg-sunken p-4 text-center">
          <p className="label-eyebrow">{willReceive ? 'You will receive' : 'You will pay'}</p>
          <div className="mt-1.5">
            <Money amountMinor={amount} size="xl" tone={willReceive ? 'positive' : 'negative'} compactDecimals />
          </div>
        </div>

        <Field label={willReceive ? 'Into account' : 'From account'} required>
          {({ id }) => (
            <select
              id={id}
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className="h-11 w-full rounded-md border border-line bg-sunken px-3.5 text-[15px] text-ink focus:border-gold focus:bg-surface focus:outline-none focus:ring-4 focus:ring-[--k-gold-ring]"
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {formatMoney(account.balanceMinor, { currency, compactDecimals: true })}
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
