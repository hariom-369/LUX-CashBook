import { useState } from 'react';
import { Copy, Plus, Target, Trash2, X } from 'lucide-react';
import { formatMoney, formatPercent } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { ConfirmDialog } from '../../components/ui/Sheet';
import { useToast } from '../../components/ui/Toast';
import { useBudgets, useBudgetSuggestions, useInvalidatePlanning } from '../../lib/queries3';
import { useCurrency } from '../../hooks/useCurrency';
import { api, errorMessage } from '../../lib/api';
import { BudgetFormSheet } from './BudgetFormSheet';
import type { BudgetProgressDto, BudgetSuggestionDto } from '@khata/shared';
import { useT, msg, type MessageRef } from '../../i18n';

/**
 * Budgets (§29).
 *
 * Every card shows used, remaining and a percentage — the three numbers a budget
 * exists to answer — plus a bar whose colour escalates through the same
 * safe/warning/critical/exceeded states the alerts use, so the visual and the
 * notification never disagree about how worried to be.
 */
export function BudgetsPage() {
  const t = useT();
  const { data: budgets = [], isLoading, isError, error, refetch } = useBudgets();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BudgetProgressDto | null>(null);
  const [prefill, setPrefill] = useState<{ categoryId: string; amountMinor: number } | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{t('nav.budgets')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">{t('budgets.monthlyLimitsByCategoryTrackedAutomatica')}</p>
        </div>
        <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          {t('budgets.addBudget')}
        </Button>
      </header>

      <BudgetSuggestions
        onPick={(suggestion) => {
          setPrefill({ categoryId: suggestion.categoryId, amountMinor: suggestion.lastMonthSpentMinor });
          setCreating(true);
        }}
      />

      {isLoading ? (
        <Card>
          <LoadingState rows={3} />
        </Card>
      ) : isError ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : budgets.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target className="size-5" />}
            title={t('budgets.noBudgetsYet')}
            description={t('budgets.setAMonthlyLimitForA')}
            action={
              <Button variant="gold" size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                {t('budgets.addYourFirstBudget')}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {budgets.map((budget) => (
            <BudgetCard key={budget.id} budget={budget} onEdit={() => setEditing(budget)} />
          ))}
        </div>
      )}

      <BudgetFormSheet
        open={creating || Boolean(editing)}
        budget={editing}
        prefill={prefill}
        onClose={() => {
          setCreating(false);
          setEditing(null);
          setPrefill(null);
        }}
      />
    </div>
  );
}

/** "Copy last month" (§Phase 7) — a suggestion only; nothing is created until picked. */
function BudgetSuggestions({ onPick }: { onPick: (suggestion: BudgetSuggestionDto) => void }) {
  const t = useT();
  const { data: suggestions = [] } = useBudgetSuggestions();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || suggestions.length === 0) return null;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <Copy className="size-4 text-gold" />
          {t('budgets.setABudgetFromLastMonth')}
        </div>
        <button type="button" onClick={() => setDismissed(true)} aria-label={t('common.dismiss')} className="rounded-sm p-1 text-ink-faint hover:bg-sunken hover:text-ink">
          <X className="size-3.5" />
        </button>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {suggestions.slice(0, 6).map((s) => (
          <li key={s.categoryId}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className="flex items-center gap-2 rounded-md border border-line-faint px-3 py-1.5 text-[12.5px] text-ink transition-colors hover:border-gold hover:bg-gold-soft"
            >
              {s.categoryName}
              <Money amountMinor={s.lastMonthSpentMinor} size="xs" tone="neutral" compactDecimals />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const STATUS_BAR: Record<BudgetProgressDto['status'], string> = {
  safe: 'bg-positive',
  warning: 'bg-warning',
  critical: 'bg-warning',
  exceeded: 'bg-negative',
};

const STATUS_BADGE: Record<BudgetProgressDto['status'], { tone: 'positive' | 'warning' | 'negative'; label: MessageRef }> = {
  safe: { tone: 'positive', label: msg('budgets.onTrack') },
  warning: { tone: 'warning', label: msg('budgets.watchThis') },
  critical: { tone: 'warning', label: msg('budgets.almostThere') },
  exceeded: { tone: 'negative', label: msg('budgets.overBudget') },
};

function BudgetCard({ budget, onEdit }: { budget: BudgetProgressDto; onEdit: () => void }) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidatePlanning();
  const currency = useCurrency();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await api.delete(`/budgets/${budget.id}`);
      invalidate();
      toast.success(t('budgets.budgetRemoved'));
    } catch (err) {
      toast.error(t('budgets.couldNotRemoveThatBudget'), errorMessage(err));
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  const status = STATUS_BADGE[budget.status];
  const barWidth = Math.min(100, Math.max(0, budget.percentUsed));

  return (
    <>
      <Card interactive onClick={onEdit} className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-ink">{budget.name}</p>
            <p className="mt-0.5 text-[11.5px] capitalize text-ink-muted">{budget.period}</p>
          </div>
          <Badge tone={status.tone}>{t(status.label.key)}</Badge>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <Money amountMinor={budget.spentMinor} size="lg" tone="neutral" compactDecimals />
            <span className="sensitive text-[12px] text-ink-muted">
              {t('common.of')} {formatMoney(budget.amountMinor, { currency, compactDecimals: true })}
            </span>
          </div>

          <div aria-hidden className="mt-2.5 h-2 overflow-hidden rounded-full bg-sunken">
            <div
              className={cn('h-full rounded-full transition-[width] duration-500', STATUS_BAR[budget.status])}
              style={{ width: `${barWidth}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-[11.5px] text-ink-muted">
            <span>{formatPercent(budget.percentUsed)} {t('budgets.used')}</span>
            <span className={cn(budget.remainingMinor < 0 && 'text-negative')}>
              {budget.remainingMinor >= 0
                ? t('budgets.amountLeft', { amount: formatMoney(budget.remainingMinor, { currency, compactDecimals: true }) })
                : t('budgets.amountOver', { amount: formatMoney(-budget.remainingMinor, { currency, compactDecimals: true }) })}
            </span>
          </div>
        </div>

        {budget.daysRemaining > 0 && budget.remainingMinor > 0 && (
          <p className="rounded-md border border-line-faint bg-sunken px-3 py-2 text-[11.5px] text-ink-muted">
            {t.plural('budgets.safeDailyKeeps', budget.daysRemaining, { amount: formatMoney(budget.safeDailyMinor, { currency, compactDecimals: true }) })}
          </p>
        )}

        {budget.daysRemaining > 0 && (
          <p className="text-[11px] text-ink-faint">
            {t('budgets.projected')} {formatMoney(budget.projectedSpendMinor, { currency, compactDecimals: true })} {t('budgets.byPeriodEnd')}
            {budget.projectedSpendMinor > budget.amountMinor && ' — over budget at this rate'} {t('budgets.estimate')}
          </p>
        )}

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setConfirmDelete(true);
          }}
          className="flex w-fit items-center gap-1.5 text-[11.5px] font-medium text-ink-faint transition-colors hover:text-negative"
        >
          <Trash2 aria-hidden className="size-3.5" />
          {t('common.remove')}
        </button>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
        title={t('budgets.removeTheBudget', { name: budget.name })}
        description={t('budgets.thisOnlyRemovesTheLimitNothing')}
        confirmLabel={t('common.remove')}
        tone="danger"
        busy={busy}
      />
    </>
  );
}
