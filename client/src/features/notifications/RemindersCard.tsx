import { useState } from 'react';
import { BellPlus, CalendarClock, Check, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toDateKey, type ReminderDto, type ReminderType } from '@khata/shared';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { Money } from '../../components/ui/Money';
import { Sheet } from '../../components/ui/Sheet';
import { useToast } from '../../components/ui/Toast';
import { useInvalidatePlanning, useReminders } from '../../lib/queries3';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';
import { cn } from '../../lib/cn';
import { useT } from '../../i18n';
import { useRelativeDay } from '../../i18n/relativeDay';
import type { MessageKey } from '../../i18n/messages/en';
import { useOfflineCreate } from '../../hooks/useOfflineCreate';

/**
 * Types a person creates themselves. Loan reminders are generated from loans
 * (and shown in "Due soon" and People), so they aren't managed here — deleting
 * one would just see it recreated.
 */
const USER_TYPES = ['bill', 'rent', 'emi', 'subscription', 'custom'] as const satisfies readonly ReminderType[];
type UserReminderType = (typeof USER_TYPES)[number];
const LEAD_DAYS = [0, 1, 3, 7] as const;

/**
 * Custom reminders (§18). The API has always supported them; this makes them
 * reachable. Due reminders notify through the same pipeline as everything else,
 * subject to the in-app notification switch.
 */
export function RemindersCard() {
  const t = useT();
  const relativeDay = useRelativeDay();
  const toast = useToast();
  const { data, isLoading, isError } = useReminders();
  const invalidatePlanning = useInvalidatePlanning();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reminders = (data ?? [])
    .filter((r) => (USER_TYPES as readonly string[]).includes(r.type))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  function refresh() {
    invalidatePlanning();
    const ws = useAuthStore.getState().activeWorkspaceId ?? 'none';
    void queryClient.invalidateQueries({ queryKey: [ws, 'dashboard'] });
  }

  async function act(reminder: ReminderDto, action: 'complete' | 'delete') {
    setBusyId(reminder.id);
    try {
      if (action === 'complete') await api.post(`/reminders/${reminder.id}/complete`);
      else await api.delete(`/reminders/${reminder.id}`);
      toast.success(t(action === 'complete' ? 'reminders.completed' : 'reminders.deleted'));
      refresh();
    } catch (err) {
      toast.error(t('reminders.failed'), errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card bare>
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3 sm:p-6 sm:pb-3">
        <CardHeader eyebrow={t('reminders.title')} title={t('reminders.description')} className="min-w-0 flex-1 basis-48" />
        <Button variant="secondary" size="sm" leftIcon={<BellPlus className="size-3.5" />} onClick={() => setAdding(true)}>
          {t('reminders.add')}
        </Button>
      </div>

      {isLoading ? null : isError ? (
        <p className="border-t border-line-faint px-5 py-4 text-[12.5px] text-negative sm:px-6">{t('reminders.error')}</p>
      ) : reminders.length === 0 ? (
        <p className="border-t border-line-faint px-5 py-4 text-[12.5px] text-ink-muted sm:px-6">{t('reminders.empty')}</p>
      ) : (
        <ul className="divide-y divide-line-faint border-t border-line-faint">
          {reminders.map((reminder) => {
            const overdue = reminder.dueDate.slice(0, 10) < toDateKey(new Date());
            return (
              <li key={reminder.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                <span
                  aria-hidden
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-md',
                    overdue ? 'bg-negative-soft text-negative' : 'bg-neutral-soft text-ink-secondary',
                  )}
                >
                  <CalendarClock className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-3 gap-y-1">
                  <span className="min-w-0 flex-1 basis-24">
                    <span className="block truncate text-[13px] font-medium text-ink">{reminder.title}</span>
                    <span className="block truncate text-[11.5px] text-ink-muted">
                      {t(`reminders.type.${reminder.type}` as MessageKey)} ·{' '}
                      {overdue ? t('reminders.overdue', { when: relativeDay(reminder.dueDate) }) : relativeDay(reminder.dueDate)}
                    </span>
                  </span>
                  {reminder.amountMinor ? <Money amountMinor={reminder.amountMinor} size="sm" tone="neutral" /> : null}
                </span>
                <span className="flex shrink-0 items-center">
                  <button
                    type="button"
                    disabled={busyId === reminder.id}
                    onClick={() => void act(reminder, 'complete')}
                    aria-label={t('reminders.done', { title: reminder.title })}
                    title={t('reminders.done', { title: reminder.title })}
                    className="rounded-md p-2 text-ink-muted transition-colors hover:bg-sunken hover:text-positive disabled:opacity-40"
                  >
                    <Check aria-hidden className="size-4" />
                  </button>
                  <button
                    type="button"
                    disabled={busyId === reminder.id}
                    onClick={() => void act(reminder, 'delete')}
                    aria-label={t('reminders.delete', { title: reminder.title })}
                    title={t('reminders.delete', { title: reminder.title })}
                    className="rounded-md p-2 text-ink-muted transition-colors hover:bg-sunken hover:text-negative disabled:opacity-40"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <ReminderFormSheet
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          toast.success(t('reminders.saved'));
          refresh();
        }}
      />
    </Card>
  );
}

function ReminderFormSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const createOrQueue = useOfflineCreate();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<UserReminderType>('bill');
  const [dueDate, setDueDate] = useState(() => toDateKey(new Date()));
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [notifyDaysBefore, setNotifyDaysBefore] = useState<number>(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function reset() {
    setTitle('');
    setType('bill');
    setDueDate(toDateKey(new Date()));
    setAmountMinor(null);
    setNotifyDaysBefore(1);
    setErrors({});
  }

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      const created = await createOrQueue('/reminders', {
        title,
        type,
        dueDate: new Date(`${dueDate}T09:00:00`).toISOString(),
        notifyDaysBefore,
        ...(amountMinor ? { amountMinor } : {}),
      });
      reset();
      // Queued offline: the hook has already told the user, so just close.
      if (created) onSaved();
      else onClose();
    } catch (err) {
      if (err instanceof ApiRequestError && err.fields.length) {
        setErrors(Object.fromEntries(err.fields.map((f) => [f.path, f.message])));
      } else {
        setErrors({ form: errorMessage(err) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      busy={busy}
      title={t('reminders.form.title')}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={!title.trim() || !dueDate} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() && dueDate) void save();
        }}
      >
        {errors.form && <p className="text-[12.5px] text-negative">{errors.form}</p>}
        <Field label={t('reminders.form.name')} required error={errors.title}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={title}
              maxLength={120}
              placeholder={t('reminders.form.namePlaceholder')}
              aria-describedby={describedBy}
              invalid={invalid}
              onChange={(event) => setTitle(event.target.value)}
            />
          )}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('reminders.form.type')}>
            {({ id }) => (
              <Select id={id} value={type} onChange={(event) => setType(event.target.value as UserReminderType)}>
                {USER_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {t(`reminders.type.${option}` as MessageKey)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('reminders.form.due')} required error={errors.dueDate}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="date"
                value={dueDate}
                aria-describedby={describedBy}
                invalid={invalid}
                onChange={(event) => setDueDate(event.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('reminders.form.amount')} hint={t('reminders.form.amountHint')} error={errors.amountMinor}>
            {({ id, describedBy, invalid }) => (
              <MoneyInput id={id} value={amountMinor} onChange={setAmountMinor} aria-describedby={describedBy} invalid={invalid} />
            )}
          </Field>
          <Field label={t('reminders.form.lead')}>
            {({ id }) => (
              <Select id={id} value={notifyDaysBefore} onChange={(event) => setNotifyDaysBefore(Number(event.target.value))}>
                {LEAD_DAYS.map((days) => (
                  <option key={days} value={days}>
                    {t(`reminders.form.lead.${days}` as MessageKey)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </form>
    </Sheet>
  );
}
