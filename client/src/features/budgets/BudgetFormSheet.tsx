import { useEffect, useState } from 'react';
import { DEFAULT_BUDGET_THRESHOLDS, type BudgetProgressDto } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Select } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { useToast } from '../../components/ui/Toast';
import { useAccounts, useCategories } from '../../lib/queries';
import { useInvalidatePlanning } from '../../lib/queries3';
import { ApiRequestError, errorMessage } from '../../lib/api';
import { useOfflinePatch } from '../../hooks/useOfflinePatch';
import { useT } from '../../i18n';
import { useOfflineCreate } from '../../hooks/useOfflineCreate';

export function BudgetFormSheet({
  open,
  budget,
  prefill,
  onClose,
}: {
  open: boolean;
  budget: BudgetProgressDto | null;
  /** A "copy last month" suggestion to start from (ignored once editing an existing budget). */
  prefill?: { categoryId: string; amountMinor: number } | null;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const createOrQueue = useOfflineCreate();
  const patchOrQueue = useOfflinePatch();
  const invalidate = useInvalidatePlanning();
  const { data: categories = [] } = useCategories('expense');
  const { data: accounts = [] } = useAccounts();
  const isEdit = Boolean(budget);

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
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
      setAccountId(budget.accountId ?? '');
      setAmountMinor(budget.amountMinor);
      setPeriod(budget.period);
      setRollover(budget.rollover);
    } else {
      setName('');
      setCategoryId(prefill?.categoryId ?? '');
      setAccountId('');
      setAmountMinor(prefill?.amountMinor ?? null);
      setPeriod('monthly');
      setRollover(false);
    }
  }, [open, budget, prefill]);

  // A budget without a name reads naturally as "the category's budget" —
  // auto-fill so most users never have to type one.
  useEffect(() => {
    if (isEdit || !categoryId) return;
    const category = categories.find((c) => c.id === categoryId);
    if (category && !name) setName(t('budgets.nameBudget', { name: category.name }));
  }, [categoryId, categories, isEdit, name, t]);

  async function save() {
    if (!amountMinor || amountMinor <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        categoryId: categoryId || null,
        accountId: accountId || null,
        amountMinor,
        period,
        rollover,
      };
      if (budget) {
        await patchOrQueue(`/budgets/${budget.id}`, { ...payload, rev: budget.rev });
        toast.success(t('budgets.budgetUpdated'));
      } else {
        if (await createOrQueue('/budgets', payload)) toast.success(t('budgets.budgetCreated'));
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
      title={isEdit ? t('budgets.editBudget') : t('budgets.newBudget')}
      size="sm"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={!amountMinor || amountMinor <= 0} onClick={() => void save()}>
            {isEdit ? t('common.saveChanges') : t('budgets.createBudget')}
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

        <Field label={t('common.category')} required>
          {({ id }) => (
            <Select id={id} value={categoryId} onChange={(event) => setCategoryId(event.target.value)} disabled={isEdit}>
              <option value="">{t('budgets.overallSpending')}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={t('common.account')} hint={t('budgets.optionalLimitsThisBudgetToSpending')}>
          {({ id }) => (
            <Select id={id} value={accountId} onChange={(event) => setAccountId(event.target.value)} disabled={isEdit}>
              <option value="">{t('common.allAccounts')}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={t('budgets.budgetAmount')} required>
          {({ id }) => <MoneyInput id={id} size="hero" autoFocus value={amountMinor} onChange={setAmountMinor} />}
        </Field>

        <Field label={t('common.name')} hint={t('budgets.shownOnTheBudgetCard')}>
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

        <Field label={t('common.period')}>
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
            <span className="block text-[13px] font-medium text-ink">{t('budgets.rollOverUnusedAmount')}</span>
            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-muted">
              {t('budgets.unspentBudgetCarriesIntoTheNext')}
            </span>
          </span>
        </label>

        <p className="text-[11.5px] leading-relaxed text-ink-faint">
          {t('budgets.youLlBeAlertedAt')} {DEFAULT_BUDGET_THRESHOLDS.join('%, ')}{t('budgets.ofThisBudget')}
        </p>
      </form>
    </Sheet>
  );
}
