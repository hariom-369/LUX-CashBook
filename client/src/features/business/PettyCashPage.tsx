import { useState } from 'react';
import { Coins, Plus, RefreshCw } from 'lucide-react';
import { formatMoney, type PettyCashDto } from '@khata/shared';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { Field, Select } from '../../components/ui/Input';
import { Sheet } from '../../components/ui/Sheet';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { usePettyCash, useInvalidateBusiness } from '../../lib/queries4';
import { useAccounts } from '../../lib/queries';
import { useCurrency } from '../../hooks/useCurrency';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { api, ApiRequestError, errorMessage } from '../../lib/api';

/**
 * Petty cash (§22).
 *
 * Under the imprest system the float always returns to the same target amount —
 * "Replenish" is deliberately a single button with no amount field, because the
 * correct replenishment amount is never a judgement call, it's exactly what was
 * spent since the last top-up.
 */
export function PettyCashPage() {
  const { data: records = [], isLoading, isError, error, refetch } = usePettyCash();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">Petty Cash</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">Imprest floats and replenishment.</p>
        </div>
        <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          Set up petty cash
        </Button>
      </header>

      {isLoading ? (
        <Card>
          <LoadingState rows={3} />
        </Card>
      ) : isError ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : records.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Coins className="size-5" />}
            title="No petty cash set up"
            description="Pick a cash account, set its imprest float, and track small expenses without them cluttering your main cash book."
            action={
              <Button variant="gold" size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                Set up petty cash
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {records.map((record) => (
            <PettyCashCard key={record.id} record={record} />
          ))}
        </div>
      )}

      <SetupSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function PettyCashCard({ record }: { record: PettyCashDto }) {
  const toast = useToast();
  const invalidate = useInvalidateBusiness();
  const currency = useCurrency();
  const [busy, setBusy] = useState(false);

  const percentRemaining = record.imprestMinor > 0 ? (record.currentMinor / record.imprestMinor) * 100 : 0;

  async function replenish() {
    setBusy(true);
    try {
      const result = await api.post<{ replenishedMinor: number }>(`/petty-cash/${record.id}/replenish`);
      invalidate();
      toast.success('Float replenished', `${formatMoney(result.replenishedMinor, { currency, compactDecimals: true })} added back.`);
    } catch (err) {
      toast.error('Could not replenish', err instanceof ApiRequestError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[14px] font-semibold text-ink">{record.accountName}</p>
          {record.custodian && <p className="mt-0.5 text-[11.5px] text-ink-muted">Held by {record.custodian}</p>}
        </div>
        <Coins aria-hidden className="size-5 text-gold" />
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <Money amountMinor={record.currentMinor} size="lg" tone="neutral" compactDecimals />
          <span className="sensitive text-[12px] text-ink-muted">of {formatMoney(record.imprestMinor, { currency, compactDecimals: true })} float</span>
        </div>
        <div aria-hidden className="mt-2.5 h-2 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-gold transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, percentRemaining))}%` }} />
        </div>
      </div>

      {record.spentSinceReplenishMinor > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line-faint bg-sunken px-3.5 py-2.5">
          <span className="text-[12px] text-ink-muted">
            Spent since last top-up: <Money amountMinor={record.spentSinceReplenishMinor} size="xs" tone="inherit" weight="medium" compactDecimals />
          </span>
          <Button size="sm" variant="secondary" loading={busy} leftIcon={<RefreshCw className="size-3.5" />} onClick={() => void replenish()}>
            Replenish
          </Button>
        </div>
      ) : (
        <p className="rounded-md border border-line-faint bg-positive-soft px-3.5 py-2.5 text-[12px] text-positive">Float is fully topped up.</p>
      )}
    </Card>
  );
}

function SetupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateBusiness();
  const { data: accounts = [] } = useAccounts();
  const cashAccounts = accounts.filter((a) => a.type === 'cash');
  const fundingAccounts = accounts.filter((a) => a.type !== 'cash');

  const [accountId, setAccountId] = useState('');
  const [imprestMinor, setImprestMinor] = useState<number | null>(null);
  const [replenishFromAccountId, setReplenishFromAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!accountId || !imprestMinor || imprestMinor <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/petty-cash', { accountId, imprestMinor, replenishFromAccountId: replenishFromAccountId || undefined });
      invalidate();
      toast.success('Petty cash set up');
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
      title="Set up petty cash"
      description="Choose a cash account and its imprest float — the amount it should always be topped back up to."
      size="sm"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="gold" loading={busy} disabled={!accountId || !imprestMinor} onClick={() => void save()}>
            Set up
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
        <Field label="Cash account" required>
          {({ id }) => (
            <Select id={id} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Choose…</option>
              {cashAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Imprest float" hint="The amount this drawer is always topped back up to." required>
          {({ id }) => <MoneyInput id={id} size="hero" value={imprestMinor} onChange={setImprestMinor} />}
        </Field>
        <Field label="Replenish from" hint="Optional — the account replenishments are drawn from.">
          {({ id }) => (
            <Select id={id} value={replenishFromAccountId} onChange={(event) => setReplenishFromAccountId(event.target.value)}>
              <option value="">Choose each time</option>
              {fundingAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </Sheet>
  );
}
