import { Link } from 'react-router-dom';
import { CreditCard, HandCoins, ShieldCheck } from 'lucide-react';
import { formatMoney } from '@khata/shared';
import { Card, CardHeader } from '../../components/ui/Card';
import { Money } from '../../components/ui/Money';
import { ErrorState, LoadingState, Skeleton } from '../../components/ui/States';
import { useDashboard } from '../../lib/queries';
import { useBudgets } from '../../lib/queries3';
import { useTodaySpend } from '../../lib/queries5';
import { useAuthStore } from '../../stores/auth.store';
import { useCurrency } from '../../hooks/useCurrency';
import { useT } from '../../i18n';
import { AddTransactionButton, BalanceHeader, PeoplePanel, UpcomingPanel } from './DashboardPage';

/** How many people and due items the simple view lists before sending you to the full screen. */
const SHORT_LIST = 3;

/**
 * Daily Money (§Phase 2) — the optional simplified start screen.
 *
 * It answers five everyday questions and nothing else: how much do I have, what did I
 * spend today, what is safe to spend, what is due, who owes whom. Every figure comes
 * from the same endpoints and the same arithmetic as the full dashboard — this screen
 * adds no accounting rule of its own, it only chooses less to show. The full dashboard
 * is one tap away and stays the default for everyone who has not opted in.
 */
export function DailyMoneyPage() {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useDashboard('last_30_days');
  const userName = useAuthStore((s) => s.user?.name?.split(' ')[0] ?? '');

  if (isLoading) return <DailySkeleton />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

  return (
    <div className="flex flex-col gap-5">
      <BalanceHeader
        greeting={userName ? t(`dashboard.greeting.${part}Named`, { name: userName }) : t(`dashboard.greeting.${part}`)}
        totalMinor={data.totalBalanceMinor}
        netWorthMinor={data.netWorthMinor}
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <TodaySpendCard />
        <SafeToSpendCard />
      </div>

      <UpcomingPanel items={data.upcoming.slice(0, SHORT_LIST + 2)} />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <PeoplePanel
          title={t('dashboard.moneyToReceive')}
          eyebrow={t('dashboard.receivables')}
          tone="positive"
          icon={<HandCoins className="size-4" />}
          totalMinor={data.receivables.totalMinor}
          people={data.receivables.people.slice(0, SHORT_LIST)}
          emptyText={t('dashboard.nobodyOwesYouAnythingRightNow')}
        />
        <PeoplePanel
          title={t('dashboard.moneyToPay')}
          eyebrow={t('dashboard.payables')}
          tone="negative"
          icon={<CreditCard className="size-4" />}
          totalMinor={data.payables.totalMinor}
          people={data.payables.people.slice(0, SHORT_LIST)}
          emptyText={t('dashboard.youDonTOweAnyoneRight')}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <AddTransactionButton />
        <Link to="/?full=1" className="text-[12.5px] font-medium text-gold underline-offset-4 hover:underline">
          {t('daily.openFullDashboard')}
        </Link>
      </div>
    </div>
  );
}

function TodaySpendCard() {
  const t = useT();
  const { data, isLoading, isError, refetch } = useTodaySpend();

  return (
    <Card>
      <CardHeader eyebrow={t('daily.today')} title={t('daily.spentToday')} />
      <div className="mt-3">
        {isLoading ? (
          <Skeleton className="h-9 w-40" />
        ) : isError ? (
          <p role="alert" className="text-[13px] text-negative">
            {t('daily.couldNotLoadToday')}{' '}
            <button type="button" onClick={() => void refetch()} className="font-medium underline underline-offset-4">
              {t('common.retry')}
            </button>
          </p>
        ) : (
          <>
            <Money amountMinor={data ?? 0} size="xl" tone="neutral" compactDecimals />
            {(data ?? 0) === 0 && <p className="mt-1 text-[12.5px] text-ink-muted">{t('daily.nothingSpentYet')}</p>}
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * Safe to spend, from the budgets the person already set — reusing the per-day figure the
 * budget screen computes (what keeps the budget intact over its remaining days). Only
 * overall budgets (no category, no account) are used here: a category budget answers a
 * narrower question and lives on the full dashboard. With none, it says so instead of guessing.
 */
function SafeToSpendCard() {
  const t = useT();
  // The dashboard payload carries no budgets of its own; they come from the budgets endpoint.
  const { data: budgets = [], isLoading, isError, refetch } = useBudgets();
  const currency = useCurrency();
  const money = (amountMinor: number) => formatMoney(amountMinor, { currency, compactDecimals: true });
  const overall = budgets.filter((b) => b.isActive && !b.categoryId && !b.accountId);

  return (
    <Card>
      <CardHeader
        eyebrow={t('daily.fromYourBudget')}
        title={t('daily.safeToSpend')}
        action={
          <span aria-hidden className="flex size-8 items-center justify-center rounded-md bg-positive-soft text-positive">
            <ShieldCheck className="size-4" />
          </span>
        }
      />
      {isLoading ? (
        <Skeleton className="mt-3 h-9 w-40" />
      ) : isError ? (
        <p role="alert" className="mt-3 text-[13px] text-negative">
          {t('daily.couldNotLoadBudget')}{' '}
          <button type="button" onClick={() => void refetch()} className="font-medium underline underline-offset-4">
            {t('common.retry')}
          </button>
        </p>
      ) : overall.length === 0 ? (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
          {t('daily.noOverallBudget')}{' '}
          <Link to="/budgets" className="font-medium text-gold underline underline-offset-4">
            {t('daily.setABudget')}
          </Link>
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-4">
          {overall.map((budget) => {
            const over = budget.remainingMinor < 0;
            return (
              <li key={budget.id}>
                {over ? (
                  <>
                    <Money amountMinor={-budget.remainingMinor} size="xl" tone="negative" compactDecimals />
                    <p className="mt-1 text-[12.5px] text-ink-muted">{t('daily.overBudget', { name: budget.name })}</p>
                  </>
                ) : (
                  <>
                    <Money amountMinor={budget.safeDailyMinor} size="xl" tone="neutral" compactDecimals />
                    <p className="mt-1 text-[12.5px] text-ink-muted">{t('daily.perDay', { name: budget.name })}</p>
                    <p className="text-[11.5px] text-ink-faint">
                      {t('daily.leftAndDays', { amount: money(budget.remainingMinor), days: t.plural('goals.daysLeft', budget.daysRemaining) })}
                    </p>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function DailySkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <Card>
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-4 h-11 w-64" />
      </Card>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card>
          <LoadingState rows={2} />
        </Card>
        <Card>
          <LoadingState rows={2} />
        </Card>
      </div>
    </div>
  );
}
