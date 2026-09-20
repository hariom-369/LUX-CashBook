import { useState } from 'react';
import { CalendarClock, Pause, Play, Plus, SkipForward } from 'lucide-react';
import { RECURRENCE_FREQUENCIES, TRANSACTION_META, formatDate, relativeDay } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { Icon } from '../../components/ui/Icon';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useRecurring, useInvalidatePlanning } from '../../lib/queries3';
import { api, errorMessage } from '../../lib/api';
import { RecurringFormSheet } from './RecurringFormSheet';
import type { RecurringTransactionDto } from '@khata/shared';

const FREQUENCY_LABEL: Record<(typeof RECURRENCE_FREQUENCIES)[number], string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
  custom: 'Custom',
};

/**
 * Recurring transactions (§21).
 *
 * Salary, rent, EMIs, subscriptions — anything on a schedule. Posting happens on
 * the server (`services/scheduler.service.ts`); this page is for setting the
 * schedule up and, when a specific occurrence needs it, overriding it by hand.
 */
export function RecurringPage() {
  const { data: recurring = [], isLoading, isError, error, refetch } = useRecurring();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RecurringTransactionDto | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">Recurring</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">Salary, rent, EMIs and subscriptions, on autopilot.</p>
        </div>
        <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          Add recurring
        </Button>
      </header>

      <Card bare>
        {isLoading ? (
          <div className="p-5">
            <LoadingState rows={4} />
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : recurring.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="size-5" />}
            title="Nothing scheduled"
            description="Salary, rent, SIPs, subscriptions — set them up once and they post automatically, with a reminder before each one."
            action={
              <Button variant="gold" size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                Add your first recurring entry
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line-faint">
            {recurring.map((item) => (
              <RecurringRow key={item.id} item={item} onEdit={() => setEditing(item)} />
            ))}
          </ul>
        )}
      </Card>

      <RecurringFormSheet
        open={creating || Boolean(editing)}
        recurring={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function RecurringRow({ item, onEdit }: { item: RecurringTransactionDto; onEdit: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidatePlanning();
  const meta = TRANSACTION_META[item.type];
  const [busy, setBusy] = useState<'run' | 'skip' | 'toggle' | null>(null);

  async function runNow() {
    setBusy('run');
    try {
      await api.post(`/recurring/${item.id}/run`);
      invalidate();
      toast.success(`${item.name} posted`);
    } catch (err) {
      toast.error('Could not post that', errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function skip() {
    setBusy('skip');
    try {
      await api.post(`/recurring/${item.id}/skip`);
      invalidate();
      toast.success('Occurrence skipped');
    } catch (err) {
      toast.error('Could not skip that', errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function togglePause() {
    setBusy('toggle');
    try {
      await api.patch(`/recurring/${item.id}`, { isPaused: item.isActive });
      invalidate();
      toast.success(item.isActive ? 'Paused' : 'Resumed');
    } catch (err) {
      toast.error('Could not update that', errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="flex items-center gap-3.5 px-5 py-4 sm:px-6">
      <button
        type="button"
        onClick={onEdit}
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-md',
          meta.tone === 'positive' && 'bg-positive-soft text-positive',
          meta.tone === 'negative' && 'bg-negative-soft text-negative',
          meta.tone === 'neutral' && 'bg-neutral-soft text-ink-secondary',
        )}
      >
        <Icon name={meta.icon} className="size-[18px]" />
      </button>

      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-medium text-ink">{item.name}</span>
          {!item.isActive && (
            <Badge tone="outline" eyebrow>
              Paused
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">
          {FREQUENCY_LABEL[item.frequency]} · {item.accountName} ·{' '}
          {item.isActive ? `Next ${relativeDay(item.nextRunDate)}` : `Was due ${formatDate(item.nextRunDate)}`}
        </span>
      </button>

      <Money
        amountMinor={item.amountMinor}
        size="md"
        tone={meta.isTransfer || meta.isPersonal ? 'neutral' : meta.isIncome ? 'positive' : 'negative'}
        signed={!meta.isTransfer}
        compactDecimals
      />

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => void skip()}
          disabled={busy !== null || !item.isActive}
          aria-label="Skip next occurrence"
          title="Skip next occurrence"
          className="rounded-sm p-2 text-ink-muted transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40"
        >
          <SkipForward aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => void togglePause()}
          disabled={busy !== null}
          aria-label={item.isActive ? 'Pause' : 'Resume'}
          title={item.isActive ? 'Pause' : 'Resume'}
          className="rounded-sm p-2 text-ink-muted transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40"
        >
          {item.isActive ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
        </button>
        <Button variant="secondary" size="sm" loading={busy === 'run'} disabled={busy !== null || !item.isActive} onClick={() => void runNow()}>
          Run now
        </Button>
      </div>
    </li>
  );
}
