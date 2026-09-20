import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Eye,
  EyeOff,
  GripVertical,
  HandCoins,
  LayoutGrid,
  Plus,
  RotateCcw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import {
  RANGE_PRESET_LABELS,
  formatMoney,
  formatPercent,
  relativeDay,
  type RangePreset,
} from '@khata/shared';
import { cn } from '../../lib/cn';
import { Card, CardHeader } from '../../components/ui/Card';
import { Money } from '../../components/ui/Money';
import { Badge } from '../../components/ui/Badge';
import { Icon } from '../../components/ui/Icon';
import { Button } from '../../components/ui/Button';
import { EmptyState, ErrorState, LoadingState, Skeleton } from '../../components/ui/States';
import { useDashboard } from '../../lib/queries';
import { useUiStore } from '../../stores/ui.store';
import { useAuthStore } from '../../stores/auth.store';
import { useCurrency } from '../../hooks/useCurrency';
import { CashFlowChart } from './CashFlowChart';
import { TransactionRow } from '../transactions/TransactionRow';
import { useDashboardLayoutStore, type DashboardWidgetId } from '../../stores/dashboardLayout.store';

const RANGES: RangePreset[] = ['last_7_days', 'last_30_days', 'last_3_months', 'last_6_months', 'this_year'];

/**
 * The dashboard (§7).
 *
 * Ordered by the questions people actually open a finance app to answer:
 *   1. How much do I have?
 *   2. How did this month go?
 *   3. What did I just spend on?
 *   4. Who owes me, and what is due?
 */
const WIDGET_META: Record<DashboardWidgetId, { label: string; span: 'wide' | 'narrow' }> = {
  monthSummary: { label: 'This month', span: 'narrow' },
  cashFlow: { label: 'Income vs expenses chart', span: 'wide' },
  transactions: { label: 'Recent transactions', span: 'wide' },
  quickActions: { label: 'Quick actions', span: 'narrow' },
  receivables: { label: 'Money to receive', span: 'narrow' },
  payables: { label: 'Money to pay', span: 'narrow' },
  upcoming: { label: 'Due soon', span: 'narrow' },
  insights: { label: 'Insights', span: 'narrow' },
};

export function DashboardPage() {
  const [range, setRange] = useState<RangePreset>('last_30_days');
  const { data, isLoading, isError, error, refetch } = useDashboard(range);
  const userName = useAuthStore((s) => s.user?.name?.split(' ')[0] ?? '');

  const order = useDashboardLayoutStore((s) => s.order);
  const hidden = useDashboardLayoutStore((s) => s.hidden);
  const editing = useDashboardLayoutStore((s) => s.editing);
  const setEditing = useDashboardLayoutStore((s) => s.setEditing);
  const moveWidget = useDashboardLayoutStore((s) => s.moveWidget);
  const toggleHidden = useDashboardLayoutStore((s) => s.toggleHidden);
  const reset = useDashboardLayoutStore((s) => s.reset);

  if (isLoading) return <DashboardSkeleton />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  const hasActivity =
    data.recentTransactions.length > 0 || data.month.incomeMinor > 0 || data.month.expenseMinor > 0;

  function renderWidget(id: DashboardWidgetId): ReactNode {
    switch (id) {
      case 'monthSummary':
        return <MonthSummary month={data!.month} />;

      case 'cashFlow':
        return (
          <Card bare>
            <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-0 sm:p-6 sm:pb-0">
              <CardHeader eyebrow="Cash flow" title="Income vs expenses" />
              <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
                {RANGES.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setRange(preset)}
                    aria-pressed={range === preset}
                    className={cn(
                      'whitespace-nowrap rounded-sm px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                      range === preset
                        ? 'bg-ink text-ink-inverse'
                        : 'text-ink-muted hover:bg-sunken hover:text-ink',
                    )}
                  >
                    {RANGE_PRESET_LABELS[preset]}
                  </button>
                ))}
              </div>
            </div>
            <CashFlowChart points={data!.cashFlow} />
          </Card>
        );

      case 'transactions':
        return (
          <Card bare>
            <div className="p-5 pb-3 sm:p-6 sm:pb-3">
              <CardHeader
                eyebrow="Activity"
                title="Recent transactions"
                action={
                  data!.recentTransactions.length > 0 ? (
                    <Link
                      to="/transactions"
                      className="text-[12.5px] font-medium text-gold underline-offset-4 hover:underline"
                    >
                      View all
                    </Link>
                  ) : undefined
                }
              />
            </div>

            {data!.recentTransactions.length === 0 ? (
              <EmptyState
                compact
                icon={<Wallet className="size-5" />}
                title="No transactions yet"
                description="Start by recording your first income or expense. It takes a few seconds."
                action={<AddTransactionButton />}
              />
            ) : (
              <ul className="divide-y divide-line-faint border-t border-line-faint">
                {data!.recentTransactions.map((transaction) => (
                  <TransactionRow key={transaction.id} transaction={transaction} />
                ))}
              </ul>
            )}
          </Card>
        );

      case 'quickActions':
        return <QuickActions />;

      case 'receivables':
        return (
          <PeoplePanel
            title="Money to receive"
            eyebrow="Receivables"
            tone="positive"
            icon={<HandCoins className="size-4" />}
            totalMinor={data!.receivables.totalMinor}
            people={data!.receivables.people}
            emptyText="Nobody owes you anything right now."
          />
        );

      case 'payables':
        return (
          <PeoplePanel
            title="Money to pay"
            eyebrow="Payables"
            tone="negative"
            icon={<CreditCard className="size-4" />}
            totalMinor={data!.payables.totalMinor}
            people={data!.payables.people}
            emptyText="You don't owe anyone right now."
          />
        );

      case 'upcoming':
        return <UpcomingPanel items={data!.upcoming} />;

      case 'insights':
        return hasActivity ? <InsightsPanel insights={data!.insights} /> : null;

      default:
        return null;
    }
  }

  const visible = order.filter((id) => !hidden.includes(id) && renderWidget(id) !== null);

  return (
    <div className="flex flex-col gap-5">
      <BalanceHeader
        greeting={userName ? `Good ${timeOfDay()}, ${userName}` : `Good ${timeOfDay()}`}
        totalMinor={data.totalBalanceMinor}
        netWorthMinor={data.netWorthMinor}
      />

      <AccountStrip accounts={data.accounts} />

      <DashboardCustomizeBar editing={editing} onToggle={() => setEditing(!editing)} onReset={reset} />

      {editing && (
        <HiddenWidgetsTray
          hidden={hidden}
          onShow={toggleHidden}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {(editing ? order.filter((id) => !hidden.includes(id)) : visible).map((id, index, arr) => {
          const meta = WIDGET_META[id];
          const content = renderWidget(id);
          if (!editing && content === null) return null;

          return (
            <div key={id} className={meta.span === 'wide' ? 'lg:col-span-2' : 'lg:col-span-1'}>
              {editing ? (
                <div className="flex flex-col gap-2 rounded-lg border border-dashed border-gold/40 bg-gold-soft/30 p-2">
                  <div className="flex items-center justify-between gap-2 px-1">
                    <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink-secondary">
                      <GripVertical aria-hidden className="size-3.5 text-ink-faint" />
                      {meta.label}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveWidget(id, 'up')}
                        disabled={index === 0}
                        aria-label={`Move ${meta.label} earlier`}
                        className="rounded-sm p-1 text-ink-muted transition-colors hover:bg-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-30"
                      >
                        <ChevronUp aria-hidden className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveWidget(id, 'down')}
                        disabled={index === arr.length - 1}
                        aria-label={`Move ${meta.label} later`}
                        className="rounded-sm p-1 text-ink-muted transition-colors hover:bg-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-30"
                      >
                        <ChevronDown aria-hidden className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleHidden(id)}
                        aria-label={`Hide ${meta.label}`}
                        className="rounded-sm p-1 text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
                      >
                        <EyeOff aria-hidden className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div aria-hidden={content === null} className={content === null ? 'opacity-40' : undefined}>
                    {content ?? (
                      <p className="rounded-md border border-line-faint bg-surface px-3.5 py-6 text-center text-[12.5px] text-ink-faint">
                        Nothing to show right now
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                content
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** §64 — a lightweight toolbar to enter/exit rearrange mode. */
function DashboardCustomizeBar({
  editing,
  onToggle,
  onReset,
}: {
  editing: boolean;
  onToggle: () => void;
  onReset: () => void;
}) {
  if (!editing) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
        >
          <LayoutGrid aria-hidden className="size-3.5" />
          Customize dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold/30 bg-gold-soft px-4 py-3">
      <p className="text-[12.5px] font-medium text-gold-strong">
        Drag isn't required — use the arrows on each card to reorder, or hide what you don't need.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-ink-secondary transition-colors hover:bg-surface"
        >
          <RotateCcw aria-hidden className="size-3.5" />
          Reset layout
        </button>
        <Button size="sm" variant="secondary" leftIcon={<X className="size-3.5" />} onClick={onToggle}>
          Done
        </Button>
      </div>
    </div>
  );
}

function HiddenWidgetsTray({
  hidden,
  onShow,
}: {
  hidden: DashboardWidgetId[];
  onShow: (id: DashboardWidgetId) => void;
}) {
  if (hidden.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line border-dashed bg-sunken/50 px-4 py-3">
      <span className="text-[12px] font-medium text-ink-muted">Hidden:</span>
      {hidden.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onShow(id)}
          className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[12px] font-medium text-ink-secondary transition-colors hover:border-line-strong"
        >
          <Eye aria-hidden className="size-3" />
          {WIDGET_META[id].label}
        </button>
      ))}
    </div>
  );
}

function timeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function AddTransactionButton({ variant = 'gold' as const }) {
  const setQuickAddOpen = useUiStore((s) => s.setQuickAddOpen);
  return (
    <Button size="sm" variant={variant} leftIcon={<Plus className="size-4" />} onClick={() => setQuickAddOpen(true)}>
      Add transaction
    </Button>
  );
}

/**
 * The hero figure.
 *
 * One number, large, with the privacy toggle immediately beside it — because the
 * total balance is precisely the number someone wants to hide when a colleague
 * glances over (§38).
 */
function BalanceHeader({
  greeting,
  totalMinor,
  netWorthMinor,
}: {
  greeting: string;
  totalMinor: number;
  netWorthMinor: number;
}) {
  const privacyMode = useUiStore((s) => s.privacyMode);
  const togglePrivacy = useUiStore((s) => s.togglePrivacyMode);
  const currency = useCurrency();

  return (
    <Card className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{ background: 'radial-gradient(110% 100% at 100% 0%, var(--k-gold-soft) 0%, transparent 60%)' }}
      />

      <div className="relative flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <p className="text-[13px] text-ink-muted">{greeting}</p>
          <div className="mt-1 flex items-baseline gap-3">
            <p className="label-eyebrow">Total balance</p>
            <button
              type="button"
              onClick={togglePrivacy}
              aria-pressed={privacyMode}
              aria-label={privacyMode ? 'Show amounts' : 'Hide amounts'}
              className="rounded-sm p-1 text-ink-faint transition-colors hover:text-gold"
            >
              {privacyMode ? <EyeOff aria-hidden className="size-3.5" /> : <Eye aria-hidden className="size-3.5" />}
            </button>
          </div>

          <div className="mt-2">
            <Money amountMinor={totalMinor} size="display" tone="neutral" compactDecimals />
          </div>

          <p className="mt-3 text-[12.5px] text-ink-muted">
            Net worth{' '}
            <span className="sensitive font-medium text-ink-secondary">
              {formatMoney(netWorthMinor, { currency, compactDecimals: true })}
            </span>{' '}
            <span className="text-ink-faint">· after what you owe and are owed</span>
          </p>
        </div>

        <div className="hidden sm:block">
          <AddTransactionButton />
        </div>
      </div>
    </Card>
  );
}

function AccountStrip({
  accounts,
}: {
  accounts: Array<{
    id: string;
    name: string;
    type: string;
    balanceMinor: number;
    color: string;
    icon: string;
    isLiability: boolean;
  }>;
}) {
  if (accounts.length === 0) return null;

  return (
    <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4 xl:grid-cols-5">
      {accounts.map((account) => (
        <Link
          key={account.id}
          to={`/accounts/${account.id}`}
          className="group flex min-w-[168px] flex-col justify-between gap-4 rounded-lg border border-line bg-surface p-4 shadow-xs transition-[border-color,transform] hover:-translate-y-px hover:border-line-strong sm:min-w-0"
        >
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-md"
              style={{ backgroundColor: `${account.color}1F`, color: account.color }}
            >
              <Icon name={account.icon} className="size-4" />
            </span>
            <span className="truncate text-[12.5px] font-medium text-ink-muted">{account.name}</span>
          </div>

          <Money
            amountMinor={account.balanceMinor}
            size="lg"
            tone={account.balanceMinor < 0 ? 'negative' : 'neutral'}
            compactDecimals
          />
        </Link>
      ))}
    </div>
  );
}

function MonthSummary({
  month,
  className,
}: {
  month: {
    label: string;
    incomeMinor: number;
    expenseMinor: number;
    netSavingsMinor: number;
    savingsRate: number;
    previousIncomeMinor: number;
    previousExpenseMinor: number;
  };
  className?: string;
}) {
  const expenseDelta = month.expenseMinor - month.previousExpenseMinor;

  return (
    <Card className={className}>
      <CardHeader eyebrow={month.label} title="This month" />

      <dl className="mt-5 flex flex-col gap-4">
        <SummaryRow
          icon={<ArrowDownLeft className="size-4" />}
          tone="positive"
          label="Income"
          amountMinor={month.incomeMinor}
        />
        <SummaryRow
          icon={<ArrowUpRight className="size-4" />}
          tone="negative"
          label="Expenses"
          amountMinor={month.expenseMinor}
          delta={
            month.previousExpenseMinor > 0 && Math.abs(expenseDelta) > 0
              ? { amountMinor: expenseDelta, invert: true }
              : undefined
          }
        />

        <div className="border-t border-line-faint pt-4">
          <SummaryRow
            icon={<Wallet className="size-4" />}
            tone={month.netSavingsMinor >= 0 ? 'positive' : 'negative'}
            label="Net savings"
            amountMinor={month.netSavingsMinor}
            emphasise
          />

          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[12.5px] text-ink-muted">Savings rate</span>
            <Badge tone={month.savingsRate >= 20 ? 'positive' : month.savingsRate > 0 ? 'warning' : 'neutral'}>
              {formatPercent(Math.max(month.savingsRate, 0))}
            </Badge>
          </div>

          {/* A savings rate is a proportion, so a bar reads faster than the number. */}
          <div aria-hidden className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-500 ease-[--ease-out-soft]',
                month.savingsRate >= 20 ? 'bg-positive' : month.savingsRate > 0 ? 'bg-warning' : 'bg-negative',
              )}
              style={{ width: `${Math.min(Math.max(month.savingsRate, 0), 100)}%` }}
            />
          </div>
        </div>
      </dl>
    </Card>
  );
}

function SummaryRow({
  icon,
  tone,
  label,
  amountMinor,
  delta,
  emphasise,
}: {
  icon: React.ReactNode;
  tone: 'positive' | 'negative';
  label: string;
  amountMinor: number;
  delta?: { amountMinor: number; invert?: boolean };
  emphasise?: boolean;
}) {
  const currency = useCurrency();
  // For expenses, spending more is the bad direction — so the tone flips.
  const deltaIsBad = delta ? (delta.invert ? delta.amountMinor > 0 : delta.amountMinor < 0) : false;

  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2.5 text-[13px] text-ink-secondary">
        <span
          aria-hidden
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md',
            tone === 'positive' ? 'bg-positive-soft text-positive' : 'bg-negative-soft text-negative',
          )}
        >
          {icon}
        </span>
        {label}
      </dt>
      <dd className="flex flex-col items-end gap-0.5">
        <Money
          amountMinor={amountMinor}
          size={emphasise ? 'lg' : 'md'}
          tone={amountMinor === 0 ? 'neutral' : tone}
          compactDecimals
        />
        {delta && (
          <span
            className={cn(
              'sensitive flex items-center gap-0.5 text-[11.5px]',
              deltaIsBad ? 'text-negative' : 'text-positive',
            )}
          >
            {delta.amountMinor > 0 ? (
              <TrendingUp aria-hidden className="size-3" />
            ) : (
              <TrendingDown aria-hidden className="size-3" />
            )}
            {formatMoney(Math.abs(delta.amountMinor), { currency, compactDecimals: true })} vs last month
          </span>
        )}
      </dd>
    </div>
  );
}

/** §47 — the eight actions that account for nearly all daily use. */
function QuickActions() {
  const setQuickAddOpen = useUiStore((s) => s.setQuickAddOpen);

  const actions = [
    { label: 'Income', icon: <ArrowDownLeft className="size-4" />, tone: 'positive' as const },
    { label: 'Expense', icon: <ArrowUpRight className="size-4" />, tone: 'negative' as const },
    { label: 'Transfer', icon: <ArrowLeftRight className="size-4" />, tone: 'neutral' as const },
    { label: 'Lend', icon: <HandCoins className="size-4" />, tone: 'neutral' as const },
  ];

  return (
    <Card>
      <CardHeader eyebrow="Quick actions" title="Record something" />
      <div className="mt-4 grid grid-cols-4 gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => setQuickAddOpen(true)}
            className="flex flex-col items-center gap-2 rounded-md border border-line bg-surface px-1 py-3 transition-[border-color,background-color] hover:border-line-strong hover:bg-sunken"
          >
            <span
              aria-hidden
              className={cn(
                'flex size-8 items-center justify-center rounded-md',
                action.tone === 'positive' && 'bg-positive-soft text-positive',
                action.tone === 'negative' && 'bg-negative-soft text-negative',
                action.tone === 'neutral' && 'bg-neutral-soft text-ink-secondary',
              )}
            >
              {action.icon}
            </span>
            <span className="text-[11px] font-medium text-ink-secondary">{action.label}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

function PeoplePanel({
  title,
  eyebrow,
  tone,
  icon,
  totalMinor,
  people,
  emptyText,
}: {
  title: string;
  eyebrow: string;
  tone: 'positive' | 'negative';
  icon: React.ReactNode;
  totalMinor: number;
  people: Array<{ id: string; name: string; amountMinor: number; isOverdue: boolean }>;
  emptyText: string;
}) {
  return (
    <Card bare>
      <div className="p-5 sm:p-6">
        <CardHeader
          eyebrow={eyebrow}
          title={title}
          action={
            <span
              aria-hidden
              className={cn(
                'flex size-8 items-center justify-center rounded-md',
                tone === 'positive' ? 'bg-positive-soft text-positive' : 'bg-negative-soft text-negative',
              )}
            >
              {icon}
            </span>
          }
        />
        <div className="mt-3">
          <Money amountMinor={totalMinor} size="xl" tone={totalMinor === 0 ? 'neutral' : tone} compactDecimals />
        </div>
      </div>

      {people.length === 0 ? (
        <p className="border-t border-line-faint px-5 py-4 text-[12.5px] text-ink-muted sm:px-6">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-line-faint border-t border-line-faint">
          {people.map((person) => (
            <li key={person.id}>
              <Link
                to={`/people/${person.id}`}
                className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-sunken sm:px-6"
              >
                <span className="truncate text-[13px] font-medium text-ink">{person.name}</span>
                <Money amountMinor={person.amountMinor} size="sm" tone={tone} compactDecimals />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function UpcomingPanel({
  items,
}: {
  items: Array<{
    id: string;
    title: string;
    subtitle?: string;
    amountMinor: number;
    dueDate: string;
    isOverdue: boolean;
    icon: string;
    direction: 'in' | 'out';
  }>;
}) {
  return (
    <Card bare>
      <div className="p-5 sm:p-6">
        <CardHeader eyebrow="Upcoming" title="Due soon" />
      </div>

      {items.length === 0 ? (
        <EmptyState
          compact
          icon={<CalendarClock className="size-5" />}
          title="Nothing is due"
          description="Loans with a due date and dated reminders show up here."
        />
      ) : (
        <ul className="divide-y divide-line-faint border-t border-line-faint">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
              <span
                aria-hidden
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-md',
                  item.isOverdue
                    ? 'bg-negative-soft text-negative'
                    : 'bg-neutral-soft text-ink-secondary',
                )}
              >
                <Icon name={item.icon} className="size-4" />
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">{item.title}</p>
                <p className="truncate text-[11.5px] text-ink-muted">
                  {item.isOverdue ? 'Overdue · ' : ''}
                  {relativeDay(item.dueDate)}
                  {item.subtitle ? ` · ${item.subtitle}` : ''}
                </p>
              </div>

              <Money
                amountMinor={item.amountMinor}
                size="sm"
                tone={item.direction === 'in' ? 'positive' : 'negative'}
                compactDecimals
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** §49 — descriptive only. No advice, no projections. */
function InsightsPanel({
  insights,
}: {
  insights: Array<{ id: string; text: string; tone: string; icon: string }>;
}) {
  if (insights.length === 0) return null;

  return (
    <Card bare>
      <div className="p-5 sm:p-6">
        <CardHeader
          eyebrow="Insights"
          title="What changed"
          action={
            <span aria-hidden className="flex size-8 items-center justify-center rounded-md bg-gold-soft text-gold-strong">
              <Sparkles className="size-4" />
            </span>
          }
        />
      </div>

      <ul className="divide-y divide-line-faint border-t border-line-faint">
        {insights.map((insight) => (
          <li key={insight.id} className="flex items-start gap-3 px-5 py-3.5 sm:px-6">
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md',
                insight.tone === 'positive' && 'bg-positive-soft text-positive',
                insight.tone === 'negative' && 'bg-negative-soft text-negative',
                insight.tone === 'neutral' && 'bg-neutral-soft text-ink-secondary',
              )}
            >
              <Icon name={insight.icon} className="size-3.5" />
            </span>
            <p className="sensitive text-[13px] leading-relaxed text-ink-secondary">{insight.text}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-4 h-11 w-64" />
        <Skeleton className="mt-4 h-3 w-48" />
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Card key={index}>
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="mt-4 h-6 w-24" />
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <LoadingState rows={3} />
        </Card>
        <Card className="lg:col-span-2">
          <Skeleton className="h-52 w-full" />
        </Card>
      </div>
    </div>
  );
}

