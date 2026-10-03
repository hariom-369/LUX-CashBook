import { useMemo, useState } from 'react';
import { CalendarClock, Check, Plus, Repeat, X } from 'lucide-react';
import { BILL_KIND_LABELS, diffInDays, formatDate, type RecurringTransactionDto } from '@khata/shared';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { useDetectorSuggestions, useInvalidatePlanning, useRecurring } from '../../lib/queries3';
import { api, errorMessage } from '../../lib/api';
import { RecurringFormSheet } from '../recurring/RecurringFormSheet';
import type { SubscriptionSuggestionDto } from '@khata/shared';
import { useT, msg, type MessageRef } from '../../i18n';
import { useRelativeDay } from '../../i18n/relativeDay';

type Bucket = 'overdue' | 'today' | 'week' | 'month' | 'later';

const BUCKET_LABEL: Record<Bucket, MessageRef> = {
  overdue: msg('bills.overdue'),
  today: msg('bills.dueToday'),
  week: msg('bills.thisWeek'),
  month: msg('common.thisMonth'),
  later: msg('bills.later'),
};

function bucketOf(item: RecurringTransactionDto, now: Date): Bucket {
  const days = diffInDays(new Date(item.nextRunDate), now);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 7) return 'week';
  if (days <= 31) return 'month';
  return 'later';
}

/**
 * Bills & Subscriptions centre (docs/PRODUCT_AUDIT.md U-5, Phase 3): the one
 * place that answers "what's due" for anything tagged as a bill, built
 * entirely on the existing `RecurringTransaction` model plus `billKind` —
 * there is no separate bills collection to keep in sync.
 */
export function BillsPage() {
  const t = useT();
  const { data: recurring = [], isLoading, isError, error, refetch } = useRecurring();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RecurringTransactionDto | null>(null);
  const now = useMemo(() => new Date(), []);

  const bills = useMemo(() => recurring.filter((r) => r.billKind), [recurring]);
  const grouped = useMemo(() => {
    const buckets: Record<Bucket, RecurringTransactionDto[]> = { overdue: [], today: [], week: [], month: [], later: [] };
    for (const item of bills) buckets[bucketOf(item, now)].push(item);
    return buckets;
  }, [bills, now]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{t('bills.billsSubscriptions')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">{t('bills.electricityRentEmisAndSubscriptionsGroup')}</p>
        </div>
        <Button variant="gold" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          {t('bills.addABill')}
        </Button>
      </header>

      <DetectorSuggestions />

      <Card bare>
        {isLoading ? (
          <div className="p-5">
            <LoadingState rows={4} />
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : bills.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="size-5" />}
            title={t('bills.noBillsYet')}
            description={t('bills.tagARecurringEntryWithA')}
            action={
              <Button variant="gold" size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                {t('bills.addYourFirstBill')}
              </Button>
            }
          />
        ) : (
          (['overdue', 'today', 'week', 'month', 'later'] as const)
            .filter((bucket) => grouped[bucket].length > 0)
            .map((bucket) => (
              <div key={bucket}>
                <div className="border-b border-line-faint bg-sunken/60 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted sm:px-6">
                  {t(BUCKET_LABEL[bucket].key)}
                </div>
                <ul className="divide-y divide-line-faint">
                  {grouped[bucket].map((item) => (
                    <BillRow key={item.id} item={item} onEdit={() => setEditing(item)} />
                  ))}
                </ul>
              </div>
            ))
        )}
      </Card>

      <RecurringFormSheet
        open={creating || Boolean(editing)}
        recurring={editing}
        defaultBillKind={editing ? undefined : 'other'}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function BillRow({ item, onEdit }: { item: RecurringTransactionDto; onEdit: () => void }) {
  const t = useT();
  const relativeDay = useRelativeDay();
  return (
    <li className="flex items-center gap-3.5 px-5 py-4 sm:px-6">
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-medium text-ink">{item.name}</span>
          {item.billKind && <Badge tone="outline" eyebrow>{t.label('billKind', item.billKind, BILL_KIND_LABELS[item.billKind])}</Badge>}
          {!item.autoPost && <Badge tone="gold" eyebrow>{t('bills.confirmEachTime')}</Badge>}
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">
          {item.accountName} · {relativeDay(item.nextRunDate)} · {formatDate(item.nextRunDate)}
        </span>
      </button>
      <Money amountMinor={item.amountMinor} size="md" tone="negative" signed compactDecimals />
    </li>
  );
}

function DetectorSuggestions() {
  const t = useT();
  const { data: suggestions = [], isLoading } = useDetectorSuggestions();
  const invalidate = useInvalidatePlanning();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (isLoading || suggestions.length === 0) return null;

  async function ignore(s: SubscriptionSuggestionDto) {
    setBusy(s.signature);
    try {
      await api.post('/detector/subscriptions/dismiss', { signature: s.signature });
      invalidate();
    } catch (err) {
      toast.error(t('bills.couldNotDismissThat'), errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function confirm(s: SubscriptionSuggestionDto) {
    setBusy(s.signature);
    try {
      await api.post('/detector/subscriptions/create-bill', s);
      invalidate();
      toast.success(t('bills.addedAsABillConfirmIts', { description: s.description }));
    } catch (err) {
      toast.error(t('bills.couldNotCreateThatBill'), errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <Repeat className="size-4 text-gold" />
        {t('bills.looksLikeASubscription')}
      </div>
      <p className="mt-1 text-[12px] text-ink-muted">
        {t('bills.foundFromYourRecentExpensesA')}
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {suggestions.map((s) => (
          <li key={s.signature} className="flex flex-wrap items-center gap-3 rounded-md border border-line-faint px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-ink">{s.payeeName ?? s.description}</div>
              <div className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                {s.occurrenceCount} {t('bills.times')} {s.accountName} {t('bills.nextExpected')} {formatDate(s.nextExpectedDate)}
              </div>
            </div>
            <Money amountMinor={s.amountMinor} size="sm" tone="negative" signed compactDecimals />
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void ignore(s)}
                disabled={busy !== null}
                aria-label={t('bills.ignoreThisSuggestion')}
                title={t('bills.ignore')}
                className="rounded-sm p-2 text-ink-muted transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40"
              >
                <X aria-hidden className="size-4" />
              </button>
              <Button variant="secondary" size="sm" loading={busy === s.signature} disabled={busy !== null} leftIcon={<Check className="size-3.5" />} onClick={() => void confirm(s)}>
                {t('bills.createBill')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
