import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const useTransactions = vi.fn();
let listItems: unknown[] = [];
vi.mock('../../lib/queries', () => ({
  useAccounts: () => ({ data: [{ id: 'a1', name: 'GPay', type: 'upi' }] }),
  useCategories: () => ({ data: [] }),
  usePeople: () => ({ data: [{ id: 'p1', name: 'Ravi' }] }),
  useInvalidateLedger: () => () => {},
  useTransactions: (params: unknown) => {
    useTransactions(params);
    return { data: { page: { items: listItems, total: listItems.length }, totals: undefined }, isLoading: false, isError: false, error: null, refetch: vi.fn(), isPlaceholderData: false };
  },
}));

import { TransactionsPage } from './TransactionsPage';
import { ToastProvider } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';

const lastParams = () => useTransactions.mock.calls.at(-1)![0] as Record<string, unknown>;

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/transactions']}>
      <ToastProvider>
        <TransactionsPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useTransactions.mockClear();
  listItems = [];
  act(() => useAuthStore.setState({ activeWorkspaceId: 'w1', user: null } as never));
});
afterEach(() => cleanup());

describe('<TransactionsPage> advanced filters', () => {
  it('searches a custom date range, from the start of its first day to the end of its last', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-09-30' } });

    const params = lastParams();
    expect(new Date(params.from as string).getTime()).toBe(new Date('2026-09-01T00:00:00').getTime());
    expect(new Date(params.to as string).getTime()).toBe(new Date('2026-09-30T23:59:59.999').getTime());
  });

  it('treats one end of a custom range as "since" or "until", and flags a backwards range', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-09-10' } });
    expect(lastParams().from).toBeTruthy();
    expect(lastParams().to).toBeUndefined();
    expect(screen.getByText(/Since/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-09-01' } });
    expect(screen.getByRole('alert').textContent).toBe('The end date is before the start date.');
  });

  it('sorts by amount or date, and filters by person alongside the other filters', () => {
    renderPage();
    expect(lastParams()).toMatchObject({ sortBy: 'date', sortOrder: 'desc' });
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'largest' } });
    expect(lastParams()).toMatchObject({ sortBy: 'amount', sortOrder: 'desc', page: 1 });

    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'a1' } });
    expect(lastParams()).toMatchObject({ personIds: ['p1'], accountIds: ['a1'], sortBy: 'amount' });
  });

  it('clears every filter, the person and the sort with one click', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'smallest' } });
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'p1' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);

    const params = lastParams();
    expect(params.personIds).toBeUndefined();
    expect(params).toMatchObject({ sortBy: 'date', sortOrder: 'desc' });
  });
});
