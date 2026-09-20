import { useState } from 'react';
import { Flag, Plus, Trash2 } from 'lucide-react';
import { formatMoney, formatPercent } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { Icon } from '../../components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { ConfirmDialog } from '../../components/ui/Sheet';
import { useToast } from '../../components/ui/Toast';
import { useGoals, useInvalidatePlanning } from '../../lib/queries3';
import { useCurrency } from '../../hooks/useCurrency';
import { api, errorMessage } from '../../lib/api';
import { GoalFormSheet } from './GoalFormSheet';
import { ContributeSheet } from './ContributeSheet';
import type { GoalProgressDto } from '@khata/shared';

/**
 * Savings goals (§30).
 *
 * An achieved goal moves to the bottom and gets a quiet checkmark rather than
 * disappearing — the point of a goal you hit is to be able to see that you hit it.
 */
export function GoalsPage() {
  const { data: goals = [], isLoading, isError, error, refetch } = useGoals();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<GoalProgressDto | null>(null);
  const [contributing, setContributing] = useState<GoalProgressDto | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">Goals</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">What you're saving towards.</p>
        </div>
        <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          Add goal
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
      ) : goals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Flag className="size-5" />}
            title="No goals yet"
            description="A new laptop, an emergency fund, a trip — set a target and watch your progress build."
            action={
              <Button variant="gold" size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                Add your first goal
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onEdit={() => setEditing(goal)}
              onContribute={() => setContributing(goal)}
            />
          ))}
        </div>
      )}

      <GoalFormSheet open={creating || Boolean(editing)} goal={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      <ContributeSheet goal={contributing} onClose={() => setContributing(null)} />
    </div>
  );
}

function GoalCard({
  goal,
  onEdit,
  onContribute,
}: {
  goal: GoalProgressDto;
  onEdit: () => void;
  onContribute: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidatePlanning();
  const currency = useCurrency();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await api.delete(`/goals/${goal.id}`);
      invalidate();
      toast.success('Goal removed');
    } catch (err) {
      toast.error('Could not remove that goal', errorMessage(err));
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <Card className={cn('flex flex-col gap-4', goal.isAchieved && 'border-positive/30 bg-positive-soft/30')}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-md"
              style={{ backgroundColor: `${goal.color}1F`, color: goal.color }}
            >
              <Icon name={goal.icon} className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-ink">{goal.name}</p>
              {goal.targetDate && (
                <p className="mt-0.5 text-[11.5px] text-ink-muted">
                  {goal.daysRemaining !== undefined
                    ? goal.daysRemaining > 0
                      ? `${goal.daysRemaining} days left`
                      : 'Target date passed'
                    : null}
                </p>
              )}
            </div>
          </div>
          {goal.isAchieved && <Badge tone="positive">Achieved</Badge>}
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <Money amountMinor={goal.currentMinor} size="lg" tone="neutral" compactDecimals />
            <span className="sensitive text-[12px] text-ink-muted">
              of {formatMoney(goal.targetMinor, { currency, compactDecimals: true })}
            </span>
          </div>

          <div aria-hidden className="mt-2.5 h-2 overflow-hidden rounded-full bg-sunken">
            <div
              className={cn('h-full rounded-full transition-[width] duration-700', goal.isAchieved ? 'bg-positive' : 'bg-gold')}
              style={{ width: `${Math.min(100, goal.percentComplete)}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-[11.5px] text-ink-muted">
            <span>{formatPercent(goal.percentComplete)} complete</span>
            {!goal.isAchieved && (
              <span>{formatMoney(goal.remainingMinor, { currency, compactDecimals: true })} to go</span>
            )}
          </div>
        </div>

        {!goal.isAchieved && goal.requiredMonthlyMinor && goal.requiredMonthlyMinor > 0 && (
          <p className="rounded-md border border-line-faint bg-sunken px-3 py-2 text-[11.5px] text-ink-muted">
            About {formatMoney(goal.requiredMonthlyMinor, { currency, compactDecimals: true })}/month reaches this
            by your target date.
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-3">
            {!goal.linkedAccountId && !goal.isAchieved && (
              <button
                type="button"
                onClick={onContribute}
                className="text-[12px] font-medium text-gold underline-offset-4 hover:underline"
              >
                Add contribution
              </button>
            )}
            <button
              type="button"
              onClick={onEdit}
              className="text-[12px] font-medium text-ink-muted underline-offset-4 hover:text-ink hover:underline"
            >
              Edit
            </button>
          </div>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label="Remove goal"
            className="rounded-sm p-1 text-ink-faint transition-colors hover:text-negative"
          >
            <Trash2 aria-hidden className="size-3.5" />
          </button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
        title={`Remove "${goal.name}"?`}
        description="Its contribution history goes with it. This does not affect any transactions."
        confirmLabel="Remove"
        tone="danger"
        busy={busy}
      />
    </>
  );
}
