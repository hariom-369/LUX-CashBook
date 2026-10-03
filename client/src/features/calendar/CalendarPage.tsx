import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Repeat, Bell, HandCoins } from 'lucide-react';
import {
  addDays,
  addMonths,
  endOfMonth,
  isSameDay,
  monthLabel,
  startOfMonth,
  startOfWeek,
  toDateKey,
  formatDate,
} from '@khata/shared';
import { cn } from '../../lib/cn';
import { Card } from '../../components/ui/Card';
import { Money } from '../../components/ui/Money';
import { EmptyState } from '../../components/ui/States';
import { useRecurring, useReminders } from '../../lib/queries3';
import { useT, msg } from '../../i18n';

type CalendarEvent = {
  id: string;
  date: Date;
  title: string;
  amountMinor?: number;
  kind: 'recurring' | 'reminder';
  link: string;
};

const WEEKDAY_LABELS = [msg('calendar.mon'), msg('calendar.tue'), msg('calendar.wed'), msg('calendar.thu'), msg('calendar.fri'), msg('calendar.sat'), msg('calendar.sun')];

/**
 * Financial calendar (docs/FEATURE_ROADMAP.md Phase 3): one month view of
 * everything with a date attached — bills, subscriptions and other recurring
 * items, plus loan-due and custom reminders. Reads two endpoints that already
 * exist (`/recurring`, `/reminders`); nothing new on the server.
 */
export function CalendarPage() {
  const t = useT();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(() => new Date());
  const { data: recurring = [] } = useRecurring();
  const { data: reminders = [] } = useReminders();

  const events = useMemo<CalendarEvent[]>(() => {
    const fromRecurring = recurring.map((r) => ({
      id: `recurring:${r.id}`,
      date: new Date(r.nextRunDate),
      title: r.name,
      amountMinor: r.amountMinor,
      kind: 'recurring' as const,
      link: '/recurring',
    }));
    const fromReminders = reminders.map((r) => ({
      id: `reminder:${r.id}`,
      date: new Date(r.dueDate),
      title: r.title,
      amountMinor: r.amountMinor,
      kind: 'reminder' as const,
      link: r.type === 'loan_due' ? '/people' : '/notifications',
    }));
    return [...fromRecurring, ...fromReminders];
  }, [recurring, reminders]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = toDateKey(event.date);
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [events]);

  const gridStart = startOfWeek(startOfMonth(cursor), 1);
  const gridEnd = startOfWeek(addDays(endOfMonth(cursor), 7), 1);
  const days: Date[] = [];
  for (let d = gridStart; d < gridEnd; d = addDays(d, 1)) days.push(d);

  const selectedEvents = (eventsByDay.get(toDateKey(selected)) ?? []).sort((a, b) => a.date.getTime() - b.date.getTime());

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{t('nav.calendar')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">{t('calendar.billsSubscriptionsLoansAndRemindersEvery')}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t('calendar.previousMonth')}
            onClick={() => setCursor((c) => addMonths(c, -1))}
            className="rounded-sm p-2 text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-[9ch] text-center text-[13.5px] font-medium text-ink">
            {monthLabel(cursor.getFullYear(), cursor.getMonth(), true)}
          </span>
          <button
            type="button"
            aria-label={t('calendar.nextMonth')}
            onClick={() => setCursor((c) => addMonths(c, 1))}
            className="rounded-sm p-2 text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </header>

      <Card bare>
        <div className="grid grid-cols-7 border-b border-line-faint text-center text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label.key} className="py-2">
              {t(label.key)}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const inMonth = day.getMonth() === cursor.getMonth();
            const dayEvents = eventsByDay.get(toDateKey(day)) ?? [];
            const isSelected = isSameDay(day, selected);
            const isToday = isSameDay(day, new Date());
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => setSelected(day)}
                className={cn(
                  'flex min-h-[4.25rem] flex-col items-center gap-1 border-b border-r border-line-faint py-1.5 text-[12px] transition-colors last:border-r-0 sm:min-h-[5.5rem]',
                  !inMonth && 'text-ink-faint',
                  inMonth && !isSelected && 'text-ink hover:bg-sunken',
                  isSelected && 'bg-gold-soft text-gold-strong',
                )}
              >
                <span className={cn('flex size-6 items-center justify-center rounded-full', isToday && !isSelected && 'border border-gold text-gold-strong')}>
                  {day.getDate()}
                </span>
                <span className="flex flex-wrap items-center justify-center gap-0.5">
                  {dayEvents.slice(0, 3).map((event) => (
                    <span
                      key={event.id}
                      className={cn('size-1.5 rounded-full', event.kind === 'recurring' ? 'bg-gold' : 'bg-info')}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card bare>
        <div className="border-b border-line-faint px-5 py-3 text-[13px] font-medium text-ink sm:px-6">
          {formatDate(selected)}
        </div>
        {selectedEvents.length === 0 ? (
          <EmptyState title={t('calendar.nothingDue')} description={t('calendar.noBillSubscriptionLoanOrReminder')} />
        ) : (
          <ul className="divide-y divide-line-faint">
            {selectedEvents.map((event) => (
              <li key={event.id} className="flex items-center gap-3.5 px-5 py-3.5 sm:px-6">
                <span
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-md',
                    event.kind === 'recurring' ? 'bg-gold-soft text-gold-strong' : 'bg-info-soft text-info',
                  )}
                >
                  {event.kind === 'recurring' ? <Repeat className="size-4" /> : event.link === '/people' ? <HandCoins className="size-4" /> : <Bell className="size-4" />}
                </span>
                <Link to={event.link} className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink hover:underline">
                  {event.title}
                </Link>
                {event.amountMinor !== undefined && <Money amountMinor={event.amountMinor} size="sm" tone="neutral" compactDecimals />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
