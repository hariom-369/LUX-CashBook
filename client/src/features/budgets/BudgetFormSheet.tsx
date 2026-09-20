import { useEffect, useState } from 'react';
import { DEFAULT_BUDGET_THRESHOLDS, type BudgetProgressDto } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Select } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { useToast } from '../../components/ui/Toast';
import { useCategories } from '../../lib/queries';
import { useInvalidatePlanning } from '../../lib/queries3';
import { api, ApiRequestError, errorMessage } from '../../lib/api';

export function BudgetFormSheet({
  open,
  budget,
  onClose,
}: {
  open: boolean;
  budget: BudgetProgressDto | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidatePlanning();
  const { data: categories = [] } = useCategories('expense');
  const isEdit = Boolean(budget);

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [period, setPeriod] = useState<'monthly' | 'weekly' | 'yearly'>('monthly');
  const [rollover, setRollover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (budget) {
      setName(budget.name);
      setCategoryId(budget.categoryId ?? '');
      setAmountMinor(budget.amountMinor);
      setPeriod(budget.period);
      setRollover(budget.rollover);
    } else {
      setName('');
      setCategoryId('');
      setAmountMinor(null);
      setPeriod('monthly');
      setRollover(false);
    }
  }, [open, budget]);

  // A budget without a name reads naturally as "the category's budget" —
  // auto-fill so most users never have to type one.
  useEffect(() => {
    if (isEdit || !categoryId) return;
    const category = categories.find((c) => c.id === categoryId);
    if (category && !name) setName(`${category.name} Budget`);
  }, [categoryId, categories, isEdit, name]);

  async function save() {
    if (!amountMinor || amountMinor <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        categoryId: categoryId || null,
        amountMinor,
        period,
        rollover,
      };
      if (budget) {
        await api.patch(`/budgets/${budget.id}`, payload);
        toast.success('Budget updated');
      } else {
        await api.post('/budgets', payload);
        toast.success('Budget created');
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
      title={isEdit ? 'Edit budget' : 'New budget'}
      size="sm"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="gold" loading={busy} disabled={!amountMinor || amountMinor <= 0} onClick={() => void save()}>
            {isEdit ? 'Save changes' : 'Create budget'}
          </Button>
        </div>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="flex flex-col gap-4 pb-2"
      >
        {error && (
          <div role="alert" className="rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] text-negative">
            {error}
          </div>
        )}

        <Field label="Category" required>
          {({ id }) => (
            <Select id={id} value={categoryId} onChange={(event) => setCategoryId(event.target.value)} disabled={isEdit}>
              <option value="">Overall spending</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Budget amount" required>
          {({ id }) => <MoneyInput id={id} size="hero" autoFocus value={amountMinor} onChange={setAmountMinor} />}
        </Field>

        <Field label="Name" hint="Shown on the budget card.">
          {({ id }) => (
            <input
              id={id}
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              className="h-11 w-full rounded-md border border-line bg-sunken px-3.5 text-[15px] text-ink focus:border-gold focus:bg-surface focus:outline-none focus:ring-4 focus:ring-[--k-gold-ring]"
            />
          )}
        </Field>

        <Field label="Period">
          {({ id }) => (
            <div id={id} className="grid grid-cols-3 gap-2">
              {(['weekly', 'monthly', 'yearly'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setPeriod(option)}
                  disabled={isEdit}
                  aria-pressed={period === option}
                  className={cn(
                    'h-10 rounded-md border text-[12.5px] font-medium capitalize transition-colors disabled:opacity-50',
                    period === option
                      ? 'border-gold bg-gold-soft text-gold-strong'
                      : 'border-line bg-surface text-ink-secondary hover:bg-sunken',
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </Field>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={rollover}
            onChange={(event) => setRollover(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 rounded-sm border-line text-gold focus:ring-gold"
          />
          <span>
            <span className="block text-[13px] font-medium text-ink">Roll over unused amount</span>
            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-muted">
              Unspent budget carries into the next period as extra headroom.
            </span>
          </span>
        </label>

        <p className="text-[11.5px] leading-relaxed text-ink-faint">
          You'll be alerted at {DEFAULT_BUDGET_THRESHOLDS.join('%, ')}% of this budget.
        </p>
      </form>
    </Sheet>
  );
}
