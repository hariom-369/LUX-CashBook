import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CalendarClock, ChevronRight, CreditCard, HandCoins, Info, Repeat } from 'lucide-react';
import { diffInDays, formatDate, startOfDay, type UpcomingPaymentDto } from '@khata/shared';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Money } from '../../components/ui/Money';
import { Select } from '../../components/ui/Input';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useUpcomingPayments } from '../../lib/queries5';
import { useRelativeDay } from '../../i18n/relativeDay';
import { cn } from '../../lib/cn';
import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n/messages/en';

type SourceFilter = 'all' | 'recurring' | 'loans' | 'reminders';
const WINDOWS = [7, 30, 60, 90] as const;

const SOURCE_ICON: Record<UpcomingPaymentDto['source'], ReactNode> = {
  recurring: <Repeat aria-hidden className="size-4" />,
  installment: <HandCoins aria-hidden className="size-4" />,
  loan: <HandCoins aria-hidden className="size-4" />,
  card: <CreditCard aria-hidden className="size-4" />,
  reminder: <Bell aria-hidden className="size-4" />,
};

const matches = (item: UpcomingPaymentDto, filter: SourceFilter) =>
  filter === 'all' ||
  (filter === 'recurring' && item.source === 'recurring') ||
  (filter === 'loans' && (item.source === 'loan' || item.source === 'installment')) ||
  (filter === 'reminders' && (item.source === 'reminder' || item.source === 'card'));

/**
 * Upcoming payments: every scheduled obligation in one timeline — recurring payments and bills,
 * loan due dates and installments, card due dates and reminders — with what was paid recently
 * kept separate underneath. Read-only: nothing here records or posts a payment.
 */
export function UpcomingPage() {
  const t = useT();
  const relativeDay = useRelativeDay();
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const [filter, setFilter] = useState<SourceFilter>('all');
  const { data, isLoading, isError, error, refetch, isFetching } = useUpcomingPayments(days);

  const items = useMemo(() => (data?.items ?? []).filter((i) => matches(i, filter)), [data, filter]);
  const sections = useMemo(() => {
    const today = startOfDay(new Date());
    const bucket = (i: UpcomingPaymentDto) => {
      if (i.status === 'paid') return 'paid';
      if (i.status === 'overdue') return 'overdue';
      if (i.status === 'due_today') return 'today';
      return diffInDays(new Date(i.dueDate), today) <= 7 ? 'week' : 'later';
    };
    const order = ['overdue', 'today', 'week', 'later', 'paid'] as const;
    return order.map((key) => ({ key, items: items.filter((i) => bucket(i) === key) })).filter((s) => s.items.length > 0);
  }, [items]);

  const SECTION_TITLE: Record<string, MessageKey> = {
    overdue: 'upcoming.section.overdue',
    today: 'upcoming.section.today',
    week: 'upcoming.section.week',
    later: 'upcoming.section.later',
    paid: 'upcoming.section.paid',
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{t('nav.upcoming')}</h1>
          <p className="mt-0.5 max-w-xl text-[13px] text-ink-muted">{t('upcoming.intro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={filter} onChange={(e) => setFilter(e.target.value as SourceFilter)} aria-label={t('upcoming.filterByType')} className="w-auto">
            <option value="all">{t('upcoming.filter.all')}</option>
            <option value="recurring">{t('upcoming.filter.recurring')}</option>
            <option value="loans">{t('upcoming.filter.loans')}</option>
            <option value="reminders">{t('upcoming.filter.reminders')}</option>
          </Select>
          <Select value={days} onChange={(e) => setDays(Number(e.target.value) as (typeof WINDOWS)[number])} aria-label={t('upcoming.window')} className="w-auto">
            {WINDOWS.map((d) => (
              <option key={d} value={d}>{t('upcoming.nextDays', { days: d })}</option>
            ))}
          </Select>
        </div>
      </header>

      {data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Tile label={t('upcoming.totals.goingOut')}>
            <Money amountMinor={data.totals.dueOutMinor} size="md" tone="negative" compactDecimals />
          </Tile>
          <Tile label={t('upcoming.totals.comingIn')}>
            <Money amountMinor={data.totals.dueInMinor} size="md" tone="positive" compactDecimals />
          </Tile>
          <Tile label={t('upcoming.totals.overdue')}>
            <p className={cn('text-[15px] font-semibold tabular', data.totals.overdueCount > 0 ? 'text-negative' : 'text-ink')}>{data.totals.overdueCount}</p>
          </Tile>
        </div>
      )}

      <Card bare>
        {isLoading ? (
          <div className="p-5"><LoadingState rows={5} /></div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : sections.length === 0 ? (
          <EmptyState icon={<CalendarClock className="size-5" />} title={t('upcoming.nothingScheduled')} description={t('upcoming.nothingScheduledHint', { days })} />
        ) : (
          <div className={cn(isFetching && 'opacity-70 transition-opacity')}>
            {sections.map((section) => (
              <section key={section.key} aria-labelledby={`upcoming-${section.key}`}>
                <h2
                  id={`upcoming-${section.key}`}
                  className={cn(
                    'border-y border-line-faint bg-sunken/80 px-5 py-2 text-[11.5px] font-semibold uppercase tracking-[0.07em] sm:px-6',
                    section.key === 'overdue' ? 'text-negative' : 'text-ink-muted',
                  )}
                >
                  {t(SECTION_TITLE[section.key]!)} · {section.items.length}
                </h2>
                <ul className="divide-y divide-line-faint">
                  {section.items.map((item) => (
                    <Row key={item.key} item={item} when={relativeDay(item.dateKey)} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>

      <p className="flex gap-2 rounded-md bg-gold-soft px-3.5 py-3 text-[12px] leading-relaxed text-ink-secondary">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-gold-strong" />
        <span>
          {t('upcoming.readOnlyNote')}
          {data && data.totals.withoutAmountCount > 0 && <> {t.plural('upcoming.withoutAmount', data.totals.withoutAmountCount)}</>}
          {data?.truncated && <> {t('upcoming.truncated')}</>}
        </span>
      </p>
    </div>
  );
}

function Row({ item, when }: { item: UpcomingPaymentDto; when: string }) {
  const t = useT();
  const paid = item.status === 'paid';
  const title =
    item.title ||
    (item.source === 'loan' || item.source === 'installment'
      ? t(item.direction === 'in' ? 'upcoming.owesYou' : 'upcoming.youOwe', { name: item.counterparty ?? '' })
      : t('upcoming.untitled'));
  // Further out, the relative label already is the date ("02 Nov 2026") — don't print it twice.
  const date = formatDate(item.dueDate);
  const details = [item.counterparty && item.title ? item.counterparty : null, item.accountName, when === date ? null : date].filter(Boolean).join(' · ');

  return (
    <li>
      <Link to={item.link} className={cn('flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-sunken sm:px-6', paid && 'opacity-75')}>
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-md',
            paid ? 'bg-positive-soft text-positive' : item.status === 'overdue' ? 'bg-negative-soft text-negative' : 'bg-sunken text-ink-secondary',
          )}
        >
          {SOURCE_ICON[item.source]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 break-words text-[13.5px] font-medium text-ink">{title}</p>
            {paid ? (
              <Badge tone="positive" eyebrow>{t('upcoming.status.paid')}</Badge>
            ) : item.status === 'overdue' ? (
              <Badge tone="negative" eyebrow>{t('upcoming.status.overdue')}</Badge>
            ) : null}
            {!paid && item.source === 'recurring' && (
              <Badge tone="outline">{item.autoPost ? t('upcoming.postsAutomatically') : t('upcoming.needsConfirming')}</Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">
            {[paid ? t('upcoming.paidOn', { date: when }) : when, details].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {item.amountMinor !== null ? (
            <Money amountMinor={item.amountMinor} size="sm" tone={item.direction === 'in' ? 'positive' : item.direction === 'out' ? 'negative' : 'neutral'} compactDecimals />
          ) : (
            <span className="text-[12px] text-ink-faint">{t('upcoming.noAmount')}</span>
          )}
          <ChevronRight aria-hidden className="size-4 text-ink-faint" />
        </div>
      </Link>
    </li>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3.5 shadow-xs">
      <p className="label-eyebrow">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
