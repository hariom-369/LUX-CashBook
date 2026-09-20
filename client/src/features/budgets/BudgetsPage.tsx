import { useState } from 'react';
import { Plus, Target, Trash2 } from 'lucide-react';
import { formatMoney, formatPercent } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { ConfirmDialog } from '../../components/ui/Sheet';
import { useToast } from '../../components/ui/Toast';
import { useBudgets, useInvalidatePlanning } from '../../lib/queries3';
import { useCurrency } from '../../hooks/useCurrency';
import { api, errorMessage } from '../../lib/api';
import { BudgetFormSheet } from './BudgetFormSheet';
import type { BudgetProgressDto } from '@khata/shared';

/**
 * Budgets (§29).
 *
 * Every card shows used, remaining and a percentage — the three numbers a budget
 * exists to answer — plus a bar whose colour escalates through the same
 * safe/warning/critical/exceeded states the alerts use, so the visual and the
 * notification never disagree about how worried to be.
 */
export function BudgetsPage() {
  const { data: budgets = [], isLoading, isError, error, refetch } = useBudgets();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BudgetProgressDto | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">Budgets</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">Monthly limits by category, tracked automatically.</p>
        </div>
        <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          Add budget
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
      ) : budgets.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target className="size-5" />}
            title="No budgets yet"
            description="Set a monthly limit for a category — Food, Transport, Shopping — and see exactly how close you are to it, all month."
            action={
              <Button variant="gold" size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                Add your first budget
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {budgets.map((budget) => (
            <BudgetCard key={budget.id} budget={budget} onEdit={() => setEditing(budget)} />
          ))}
        </div>
      )}

      <BudgetFormSheet
        open={creating || Boolean(editing)}
        budget={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

const STATUS_BAR: Record<BudgetProgressDto['status'], string> = {
  safe: 'bg-positive',
  warning: 'bg-warning',
  critical: 'bg-warning',
  exceeded: 'bg-negative',
};

const STATUS_BADGE: Record<BudgetProgressDto['status'], { tone: 'positive' | 'warning' | 'negative'; label: string }> = {
  safe: { tone: 'positive', label: 'On track' },
  warning: { tone: 'warning', label: 'Watch this' },
  critical: { tone: 'warning', label: 'Almost there' },
  exceeded: { tone: 'negative', label: 'Over budget' },
};

function BudgetCard({ budget, onEdit }: { budget: BudgetProgressDto; onEdit: () => void }) {
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
      toast.success('Budget removed');
    } catch (err) {
      toast.error('Could not remove that budget', errorMessage(err));
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
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <Money amountMinor={budget.spentMinor} size="lg" tone="neutral" compactDecimals />
            <span className="sensitive text-[12px] text-ink-muted">
              of {formatMoney(budget.amountMinor, { currency, compactDecimals: true })}
            </span>
          </div>

          <div aria-hidden className="mt-2.5 h-2 overflow-hidden rounded-full bg-sunken">
            <div
              className={cn('h-full rounded-full transition-[width] duration-500', STATUS_BAR[budget.status])}
              style={{ width: `${barWidth}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-[11.5px] text-ink-muted">
            <span>{formatPercent(budget.percentUsed)} used</span>
            <span className={cn(budget.remainingMinor < 0 && 'text-negative')}>
              {budget.remainingMinor >= 0
                ? `${formatMoney(budget.remainingMinor, { currency, compactDecimals: true })} left`
                : `${formatMoney(-budget.remainingMinor, { currency, compactDecimals: true })} over`}
            </span>
          </div>
        </div>

        {budget.daysRemaining > 0 && budget.remainingMinor > 0 && (
          <p className="rounded-md border border-line-faint bg-sunken px-3 py-2 text-[11.5px] text-ink-muted">
            {formatMoney(budget.safeDailyMinor, { currency, compactDecimals: true })}/day keeps you within budget
            for the remaining {budget.daysRemaining} day{budget.daysRemaining === 1 ? '' : 's'}.
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
          Remove
        </button>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
        title={`Remove the ${budget.name} budget?`}
        description="This only removes the limit. Nothing about your transactions changes."
        confirmLabel="Remove"
        tone="danger"
        busy={busy}
      />
    </>
  );
}
