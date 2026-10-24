import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MonthlyInsightsDto } from '@khata/shared';

let response: MonthlyInsightsDto | undefined;
const requested = vi.fn();
vi.mock('../../lib/queries5', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/queries5')>();
  return {
    ...actual,
    useMonthlyInsights: (month: string) => {
      requested(month);
      return { data: response, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
    },
  };
});

import { useAuthStore } from '../../stores/auth.store';
import { MonthlySummary } from './MonthlySummary';

const base: MonthlyInsightsDto = {
  month: '2026-09', from: '', to: '', isPartial: false, daysElapsed: 30, daysInMonth: 30, hasData: true, transactionCount: 6,
  incomeMinor: 60_000_00, refundsMinor: 1_000_00, expenseMinor: 35_000_00, netSavingsMinor: 25_000_00, savingsRatePercent: 41.7,
  notCounted: { transfersMinor: 5_000_00, loansAndRepaymentsMinor: 4_000_00 },
  comparisonBasis: 'previous_month',
  comparison: { month: '2026-08', from: '', to: '', incomeMinor: 50_000_00, expenseMinor: 10_000_00, netSavingsMinor: 40_000_00, hasData: true },
  categories: [{ categoryId: 'c1', name: 'Food', amountMinor: 20_000_00, sharePercent: 57.1, comparisonMinor: 10_000_00 }],
  significantChanges: [
    { kind: 'expense', currentMinor: 35_000_00, comparisonMinor: 10_000_00, changeMinor: 25_000_00, changePercent: 250 },
    { kind: 'category', categoryId: 'c2', name: 'Travel', currentMinor: 15_000_00, comparisonMinor: 0, changeMinor: 15_000_00, changePercent: null },
  ],
  projection: null,
  upcoming: null,
};

beforeEach(() => {
  requested.mockClear();
  response = base;
  act(() => useAuthStore.setState({ activeWorkspaceId: 'w1', user: null } as never));
});
afterEach(() => cleanup());

const renderIt = () =>
  render(
    <MemoryRouter>
      <MonthlySummary />
    </MemoryRouter>,
  );

describe('<MonthlySummary>', () => {
  it('shows the month\'s facts, refunds within income, and what changed', () => {
    renderIt();
    expect(screen.getByText('Income')).toBeTruthy();
    expect(screen.getByText(/Includes refunds of/)).toBeTruthy();
    expect(screen.getByText('41.7% of income')).toBeTruthy();
    expect(screen.getByText(/Spending rose by/)).toBeTruthy();
    expect(screen.getByText(/New spending on Travel/)).toBeTruthy();
    expect(screen.getByText(/are not counted as income or spending/)).toBeTruthy();
    expect(screen.queryByText('Estimate')).toBeNull();
  });

  it('marks a month in progress, compares it with the same days, and labels the projection an estimate', () => {
    response = {
      ...base, isPartial: true, daysElapsed: 10, comparisonBasis: 'previous_month_to_date',
      projection: { expenseMinor: 3_000_00, isEstimate: true },
      upcoming: { count: 2, outMinor: 12_000_00, inMinor: 0, withoutAmountCount: 0 },
    };
    renderIt();
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Counting entries up to today — day 10 of 30.')).toBeTruthy();
    expect(screen.getAllByText(/Same days of August 2026/).length).toBeGreaterThan(0);
    expect(screen.getByText('Estimate')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Still scheduled this month/ }).getAttribute('href')).toBe('/upcoming');
  });

  it('moves between months but never into the future', () => {
    renderIt();
    expect((screen.getByRole('button', { name: 'Next month' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    expect(requested).toHaveBeenLastCalledWith(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`);
  });

  it('shows no comparison at all when the month before has nothing recorded', () => {
    response = { ...base, significantChanges: [], comparison: { ...base.comparison, incomeMinor: 0, expenseMinor: 0, netSavingsMinor: 0, hasData: false } };
    renderIt();
    expect(screen.getByText(/Nothing was recorded in August 2026, so there is nothing to compare with yet/)).toBeTruthy();
    expect(screen.queryByText('What changed')).toBeNull();
    expect(screen.queryByText(/August 2026:/)).toBeNull();
  });

  it('says so when nothing was recorded', () => {
    response = { ...base, hasData: false, comparison: { ...base.comparison, hasData: false } };
    renderIt();
    expect(screen.getByText(/Nothing recorded for/)).toBeTruthy();
  });
});
