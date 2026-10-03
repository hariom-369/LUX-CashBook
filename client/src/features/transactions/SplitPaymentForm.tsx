import { useState } from 'react';
import { ArrowLeft, Check, Plus, Trash2 } from 'lucide-react';
import { allocateProportionally, toDateKey } from '@khata/shared';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { Money } from '../../components/ui/Money';
import { useToast } from '../../components/ui/Toast';
import { useAccounts, useCategories, useLedgerMutation } from '../../lib/queries';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useT } from '../../i18n';

interface Part {
  categoryId: string;
  amountMinor: number | null;
}

/**
 * Split one payment across categories (docs/PRODUCT_AUDIT.md, Phase 8) — one
 * real withdrawal from the account, recorded as several ordinary
 * transactions sharing a `splitGroupId`. Posted atomically via
 * `POST /transactions/split`: either every part lands, or none do.
 */
export function SplitPaymentForm({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories('expense');

  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(toDateKey(new Date()));
  const [description, setDescription] = useState('');
  const [totalMinor, setTotalMinor] = useState<number | null>(null);
  const [parts, setParts] = useState<Part[]>([{ categoryId: '', amountMinor: null }, { categoryId: '', amountMinor: null }]);
  const [error, setError] = useState<string | null>(null);

  const partsTotal = parts.reduce((sum, p) => sum + (p.amountMinor ?? 0), 0);
  const remaining = (totalMinor ?? 0) - partsTotal;

  const mutation = useLedgerMutation(async () => {
    if (!accountId || !totalMinor || totalMinor <= 0) throw new ApiRequestError(422, { code: 'INVALID', message: t('transactions.fillInTheAccountAndAmount') });
    if (remaining !== 0) throw new ApiRequestError(422, { code: 'INVALID', message: t('transactions.thePartsMustAddUpTo') });
    return api.post('/transactions/split', {
      type,
      accountId,
      date: new Date(`${date}T12:00:00`).toISOString(),
      description: description || undefined,
      parts: parts.map((p) => ({ categoryId: p.categoryId || null, amountMinor: p.amountMinor })),
    });
  });

  function splitEvenly() {
    if (!totalMinor) return;
    const shares = allocateProportionally(totalMinor, parts.map(() => 1));
    setParts((current) => current.map((p, i) => ({ ...p, amountMinor: shares[i] ?? 0 })));
  }

  async function submit() {
    setError(null);
    try {
      await mutation.mutateAsync(undefined as never);
      toast.success(t('transactions.splitPaymentSaved'), t('transactions.partsRecorded', { length: parts.length }));
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : errorMessage(err));
    }
  }

  const canSubmit = Boolean(accountId) && Boolean(totalMinor) && remaining === 0 && parts.every((p) => p.amountMinor && p.amountMinor > 0);

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="flex flex-col gap-4 pb-2">
      <button type="button" onClick={onBack} className="-mt-1 flex w-fit items-center gap-1.5 text-[12.5px] font-medium text-ink-muted transition-colors hover:text-ink">
        <ArrowLeft aria-hidden className="size-3.5" />
        {t('transactions.changeType')}
      </button>

      {error && (
        <div role="alert" className="rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] text-negative">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {(['expense', 'income'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setType(option)}
            aria-pressed={type === option}
            className={`h-10 rounded-md border text-[12.5px] font-medium capitalize transition-colors ${type === option ? 'border-gold bg-gold-soft text-gold-strong' : 'border-line bg-surface text-ink-secondary hover:bg-sunken'}`}
          >
            {option === 'expense' ? t('common.moneyOut') : t('common.moneyIn')}
          </button>
        ))}
      </div>

      <Field label={t('transactions.totalAmount')} required>
        {({ id }) => <MoneyInput id={id} size="hero" autoFocus value={totalMinor} onChange={setTotalMinor} />}
      </Field>

      <Field label={t('common.account')} required>
        {({ id }) => (
          <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">{t('common.choose')}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label={t('common.date')}>
          {({ id }) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label={t('common.description')} hint={t('common.optional')}>
          {({ id }) => <Input id={id} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted">{t('transactions.splitInto')}</p>
        <button type="button" onClick={splitEvenly} disabled={!totalMinor} className="text-[12px] font-medium text-gold-strong hover:underline disabled:opacity-40">
          {t('transactions.splitEvenly')}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {parts.map((part, index) => (
          <div key={index} className="flex items-center gap-2">
            <Select
              aria-label={t('transactions.categoryForPart', { n: index + 1 })}
              value={part.categoryId}
              onChange={(e) => setParts((current) => current.map((p, i) => (i === index ? { ...p, categoryId: e.target.value } : p)))}
            >
              <option value="">{t('common.uncategorised')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <label htmlFor={`split-part-amount-${index}`} className="sr-only">
              {t('transactions.amountForPart')} {index + 1}
            </label>
            <MoneyInput
              id={`split-part-amount-${index}`}
              value={part.amountMinor}
              onChange={(value) => setParts((current) => current.map((p, i) => (i === index ? { ...p, amountMinor: value } : p)))}
            />
            <button
              type="button"
              aria-label={t('transactions.removePart')}
              onClick={() => setParts((current) => current.filter((_, i) => i !== index))}
              disabled={parts.length <= 2}
              className="rounded-sm p-2 text-ink-muted transition-colors hover:bg-sunken hover:text-negative disabled:opacity-40"
            >
              <Trash2 aria-hidden className="size-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setParts((current) => [...current, { categoryId: '', amountMinor: null }])}
        disabled={parts.length >= 20}
        className="flex w-fit items-center gap-1.5 text-[12px] font-medium text-gold-strong hover:underline disabled:opacity-40"
      >
        <Plus className="size-3.5" /> {t('transactions.addAPart')}
      </button>

      <p className="text-[11.5px] text-ink-muted">
        {t('transactions.remainingToAllocate')} <Money amountMinor={Math.abs(remaining)} size="xs" tone={remaining === 0 ? 'neutral' : remaining > 0 ? 'negative' : 'negative'} compactDecimals />
        {remaining !== 0 && (remaining > 0 ? ' left to split' : ' over the total')}
      </p>

      <Button type="submit" size="lg" fullWidth variant="gold" loading={mutation.isPending} disabled={!canSubmit} leftIcon={<Check className="size-4" />}>
        {t('transactions.saveSplitPayment')}
      </Button>
    </form>
  );
}
