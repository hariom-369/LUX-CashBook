import { useState } from 'react';
import { CalendarClock, Pause, Play, Plus, SkipForward } from 'lucide-react';
import { RECURRENCE_FREQUENCIES, TRANSACTION_META, formatDate, } from '@khata/shared';
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
import { useT, msg, type MessageRef } from '../../i18n';
import { useRelativeDay } from '../../i18n/relativeDay';

const FREQUENCY_LABEL: Record<(typeof RECURRENCE_FREQUENCIES)[number], MessageRef> = {
  daily: msg('recurring.daily'),
  weekly: msg('recurring.weekly'),
  monthly: msg('recurring.monthly'),
  yearly: msg('recurring.yearly'),
  custom: msg('recurring.custom'),
};

/**
 * Recurring transactions (§21).
 *
 * Salary, rent, EMIs, subscriptions — anything on a schedule. Posting happens on
 * the server (`services/scheduler.service.ts`); this page is for setting the
 * schedule up and, when a specific occurrence needs it, overriding it by hand.
 */
export function RecurringPage() {
  const t = useT();
  const { data: recurring = [], isLoading, isError, error, refetch } = useRecurring();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RecurringTransactionDto | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{t('nav.recurring')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">{t('recurring.salaryRentEmisAndSubscriptionsOn')}</p>
        </div>
        <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          {t('recurring.addRecurring')}
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
            title={t('recurring.nothingScheduled')}
            description={t('recurring.salaryRentSipsSubscriptionsSetThem')}
            action={
              <Button variant="gold" size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                {t('recurring.addYourFirstRecurringEntry')}
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
  const t = useT();
  const relativeDay = useRelativeDay();
  const toast = useToast();
  const invalidate = useInvalidatePlanning();
  const meta = TRANSACTION_META[item.type];
  const [busy, setBusy] = useState<'run' | 'skip' | 'toggle' | null>(null);

  async function runNow() {
    setBusy('run');
    try {
      await api.post(`/recurring/${item.id}/run`);
      invalidate();
      toast.success(t('recurring.posted', { name: item.name }));
    } catch (err) {
      toast.error(t('recurring.couldNotPostThat'), errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function skip() {
    setBusy('skip');
    try {
      await api.post(`/recurring/${item.id}/skip`);
      invalidate();
      toast.success(t('recurring.occurrenceSkipped'));
    } catch (err) {
      toast.error(t('recurring.couldNotSkipThat'), errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function togglePause() {
    setBusy('toggle');
    try {
      await api.patch(`/recurring/${item.id}`, { isPaused: item.isActive });
      invalidate();
      toast.success(item.isActive ? t('recurring.paused') : t('recurring.resumed'));
    } catch (err) {
      toast.error(t('common.couldNotUpdateThat'), errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    // On phones the actions take their own line below; one row from `sm` up.
    <li className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-5 py-4 sm:flex-nowrap sm:px-6">
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
              {t('recurring.paused')}
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">
          {t(FREQUENCY_LABEL[item.frequency].key)} · {item.accountName} ·{' '}
          {item.isActive ? t('recurring.nextWhen', { when: relativeDay(item.nextRunDate) }) : t('recurring.wasDue', { date: formatDate(item.nextRunDate) })}
        </span>
      </button>

      <Money
        amountMinor={item.amountMinor}
        size="md"
        tone={meta.isTransfer || meta.isPersonal ? 'neutral' : meta.isIncome ? 'positive' : 'negative'}
        signed={!meta.isTransfer}
        compactDecimals
      />

      <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto">
        <button
          type="button"
          onClick={() => void skip()}
          disabled={busy !== null || !item.isActive}
          aria-label={t('recurring.skipNextOccurrence')}
          title={t('recurring.skipNextOccurrence')}
          className="rounded-sm p-2 text-ink-muted transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40"
        >
          <SkipForward aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => void togglePause()}
          disabled={busy !== null}
          aria-label={item.isActive ? t('recurring.pause') : t('recurring.resume')}
          title={item.isActive ? t('recurring.pause') : t('recurring.resume')}
          className="rounded-sm p-2 text-ink-muted transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40"
        >
          {item.isActive ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
        </button>
        <Button variant="secondary" size="sm" loading={busy === 'run'} disabled={busy !== null || !item.isActive} onClick={() => void runNow()}>
          {t('recurring.runNow')}
        </Button>
      </div>
    </li>
  );
}
