import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { BudgetProgressDto, DashboardDto } from '@khata/shared';

let dashboard: Partial<DashboardDto> | undefined;
let budgetList: BudgetProgressDto[] = [];
let budgetState: { isLoading: boolean; isError: boolean } = { isLoading: false, isError: false };
const refetchBudgets = vi.fn();
let dashboardState: { isLoading: boolean; isError: boolean } = { isLoading: false, isError: false };
let todaySpend: { data?: number; isLoading: boolean; isError: boolean } = { data: 0, isLoading: false, isError: false };
const refetchToday = vi.fn();

vi.mock('../../lib/queries', () => ({
  useDashboard: () => ({ data: dashboard, ...dashboardState, error: null, refetch: vi.fn() }),
}));
vi.mock('../../lib/queries3', () => ({
  useBudgets: () => ({ data: budgetList, ...budgetState, refetch: refetchBudgets }),
}));
vi.mock('../../lib/queries5', () => ({
  useTodaySpend: () => ({ ...todaySpend, refetch: refetchToday }),
}));
// The full dashboard is a different screen with its own tests; here it only has to be recognisable.
vi.mock('./CashFlowChart', () => ({ CashFlowChart: () => null }));

import { DailyMoneyPage } from './DailyMoneyPage';
import { HomeRoute } from './HomeRoute';
import { useAuthStore } from '../../stores/auth.store';
import { hi } from '../../i18n/messages/hi';

const budget = (over: Partial<BudgetProgressDto> = {}): BudgetProgressDto =>
  ({
    id: 'b1', rev: 1, workspaceId: 'w1', categoryId: null, accountId: null, name: 'Monthly budget', amountMinor: 3000000, period: 'monthly',
    startDate: '2026-10-01T00:00:00.000Z', rollover: false, alertThresholds: [], isActive: true,
    spentMinor: 1000000, remainingMinor: 2000000, percentUsed: 33, status: 'safe', daysRemaining: 20, safeDailyMinor: 100000, projectedSpendMinor: 0,
    ...over,
  }) as BudgetProgressDto;

const person = (id: string, name: string, amountMinor: number) => ({ id, name, amountMinor, isOverdue: false });

function setDashboard(over: Partial<DashboardDto> = {}) {
  dashboard = {
    totalBalanceMinor: 12345600,
    netWorthMinor: 12000000,
    accounts: [],
    upcoming: [{ id: 'u1', kind: 'recurring', title: 'Rent', amountMinor: 1500000, dueDate: '2026-10-05T00:00:00.000Z', isOverdue: false, icon: 'Home', direction: 'out' }],
    receivables: { totalMinor: 120000, people: [person('p1', 'Rahul', 120000)] },
    payables: { totalMinor: 50000, people: [person('p2', 'Meena', 50000)] },
    recentTransactions: [],
    month: { label: 'October', incomeMinor: 0, expenseMinor: 0, netSavingsMinor: 0, savingsRate: 0, previousIncomeMinor: 0, previousExpenseMinor: 0 },
    cashFlow: [],
    goals: [],
    insights: [],
    ...over,
  };
}

function renderPage() {
  render(
    <MemoryRouter>
      <DailyMoneyPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dashboardState = { isLoading: false, isError: false };
  budgetState = { isLoading: false, isError: false };
  budgetList = [budget()];
  todaySpend = { data: 25000, isLoading: false, isError: false };
  setDashboard();
  act(() => useAuthStore.setState({ activeWorkspaceId: 'w1', user: { name: 'Asha Rao', preferences: {} } } as never));
});
afterEach(() => {
  cleanup();
  act(() => useAuthStore.setState({ user: null } as never));
});

describe('<DailyMoneyPage> (§Phase 2)', () => {
  it('answers the everyday questions: balance, today, safe to spend, due, who owes whom', () => {
    renderPage();
    expect(screen.getByText('Total balance')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Spent today' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Safe to spend' })).toBeTruthy();
    expect(screen.getByText('Rent')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Rahul/ }).getAttribute('href')).toBe('/people/p1');
    expect(screen.getByRole('link', { name: /Meena/ }).getAttribute('href')).toBe('/people/p2');
  });

  it('shows the budget\'s own per-day figure, the name it protects, and what is left', () => {
    renderPage();
    expect(screen.getByText('a day keeps you within Monthly budget')).toBeTruthy();
    expect(screen.getByText(/20 days left/)).toBeTruthy();
  });

  it('says it is over, rather than showing a negative allowance, when the budget is exceeded', () => {
    budgetList = [budget({ remainingMinor: -50000, status: 'exceeded', safeDailyMinor: 0 })];
    renderPage();
    expect(screen.getByText('over Monthly budget')).toBeTruthy();
    expect(screen.queryByText(/a day keeps you within/)).toBeNull();
  });

  it('does not invent an allowance from a category or account budget', () => {
    budgetList = [budget({ categoryId: 'c1', name: 'Food' }), budget({ id: 'b3', accountId: 'a1', name: 'Card' })];
    renderPage();
    expect(screen.getByText(/Set an overall budget/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Set a budget' }).getAttribute('href')).toBe('/budgets');
    expect(screen.queryByText(/a day keeps you within/)).toBeNull();
  });

  it('ignores an inactive overall budget', () => {
    budgetList = [budget({ isActive: false })];
    renderPage();
    expect(screen.getByText(/Set an overall budget/)).toBeTruthy();
  });

  it('shows a retry for the safe-to-spend card alone when the budgets cannot be loaded', () => {
    budgetState = { isLoading: false, isError: true };
    budgetList = [];
    renderPage();
    const alert = screen.getAllByRole('alert').find((el) => /budget/i.test(el.textContent ?? ''))!;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(refetchBudgets).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Spent today' })).toBeTruthy();
  });

  it('says so when nothing has been spent today', () => {
    todaySpend = { data: 0, isLoading: false, isError: false };
    renderPage();
    expect(screen.getByText('Nothing spent yet today.')).toBeTruthy();
  });

  it('keeps the rest of the screen when only today\'s figure fails, and offers a retry', () => {
    todaySpend = { data: undefined, isLoading: false, isError: true };
    renderPage();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Could not load today');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(refetchToday).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Safe to spend' })).toBeTruthy();
  });

  it('shows at most three people on each side and links to the full dashboard', () => {
    setDashboard({
      receivables: { totalMinor: 400000, people: ['A', 'B', 'C', 'D'].map((n, i) => person(`r${i}`, `Debtor ${n}`, 100000)) },
    });
    renderPage();
    expect(screen.getAllByRole('link', { name: /Debtor/ })).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Open the full dashboard' }).getAttribute('href')).toBe('/?full=1');
  });

  it('shows a loading state and an error state for the dashboard itself', () => {
    dashboardState = { isLoading: true, isError: false };
    dashboard = undefined;
    renderPage();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    cleanup();
    dashboardState = { isLoading: false, isError: true };
    renderPage();
    expect(screen.queryByText('Total balance')).toBeNull();
  });

  it('is translated', () => {
    act(() => useAuthStore.setState({ user: { name: 'Asha', preferences: { language: 'hi' } } } as never));
    renderPage();
    expect(screen.getByRole('heading', { name: hi['daily.spentToday']! })).toBeTruthy();
    expect(screen.getByRole('heading', { name: hi['daily.safeToSpend']! })).toBeTruthy();
  });
});

describe('<HomeRoute> (§Phase 2)', () => {
  function renderAt(url: string) {
    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/today" element={<p>daily screen</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }
  const setPref = (homeScreen?: 'daily' | 'dashboard') =>
    act(() => useAuthStore.setState({ user: { name: 'Asha', preferences: { homeScreen } } } as never));

  it('opens the full dashboard by default, including for accounts that predate the setting', () => {
    setPref(undefined);
    renderAt('/');
    expect(screen.queryByText('daily screen')).toBeNull();
    expect(screen.getByText('Total balance')).toBeTruthy();
  });

  it('opens the full dashboard when that is the chosen start screen', () => {
    setPref('dashboard');
    renderAt('/');
    expect(screen.getByText('Total balance')).toBeTruthy();
  });

  it('opens Daily Money when that is the chosen start screen', () => {
    setPref('daily');
    renderAt('/');
    expect(screen.getByText('daily screen')).toBeTruthy();
  });

  it('still reaches the full dashboard from Daily Money via ?full=1', () => {
    setPref('daily');
    renderAt('/?full=1');
    expect(screen.queryByText('daily screen')).toBeNull();
    expect(screen.getByText('Total balance')).toBeTruthy();
  });
});
