import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';

const useTransactions = vi.fn();
let listItems: unknown[] = [];
vi.mock('../../lib/queries', () => ({
  useAccounts: () => ({ data: [{ id: 'a1', name: 'GPay', type: 'upi' }] }),
  useCategories: () => ({ data: [] }),
  useInvalidateLedger: () => () => {},
  useTransactions: (params: unknown) => {
    useTransactions(params);
    return { data: { page: { items: listItems, total: listItems.length }, totals: undefined }, isLoading: false, isError: false, error: null, refetch: vi.fn(), isPlaceholderData: false };
  },
}));
vi.mock('./TransactionDetailSheet', () => ({
  TransactionDetailSheet: ({ transaction }: { transaction: { rev: number; description: string } | null }) =>
    transaction ? <p data-testid="sheet">{`${transaction.description} rev ${transaction.rev}`}</p> : null,
}));

import { TransactionsPage } from './TransactionsPage';
import { ToastProvider } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';

function renderAt(url: string) {
  let go: (to: string) => void = () => {};
  function Probe() {
    go = useNavigate();
    return null;
  }
  render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Probe />
        <TransactionsPage />
      </ToastProvider>
    </MemoryRouter>,
  );
  return (to: string) => act(() => go(to));
}

const lastParams = () => useTransactions.mock.calls.at(-1)![0] as Record<string, unknown>;

beforeEach(() => {
  useTransactions.mockClear();
  listItems = [];
  act(() => useAuthStore.setState({ activeWorkspaceId: 'w1', user: null } as never));
});
afterEach(() => cleanup());

describe('<TransactionsPage> search links from the palette (§Phase 2)', () => {
  it('starts as an ordinary list when there is nothing in the URL', () => {
    renderAt('/transactions');
    const params = lastParams();
    expect(params.search).toBeUndefined();
    expect(params.types).toBeUndefined();
    expect(params.accountIds).toBeUndefined();
    expect(params.minAmountMinor).toBeUndefined();
  });

  it('applies the filters a structured search produced and opens the filter panel to show them', () => {
    renderAt('/transactions?types=expense&account=a1&min=500000&range=last_3_months');
    const params = lastParams();
    expect(params.types).toEqual(['expense']);
    expect(params.accountIds).toEqual(['a1']);
    expect(params.minAmountMinor).toBe(500000);
    expect(params.from).toBeTruthy();
    expect(screen.getByRole('button', { name: /Filters/ }).getAttribute('aria-expanded')).toBe('true');
    expect((screen.getByLabelText('Date range') as HTMLSelectElement).value).toBe('last_3_months');
  });

  it('filters to one payee, says so on a chip, and lets the chip be removed', () => {
    renderAt('/transactions?payee=py1&payeeName=Zomato');
    expect(lastParams().payeeIds).toEqual(['py1']);
    expect(screen.getByText('Payee: Zomato')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove payee filter' }));
    expect(screen.queryByText('Payee: Zomato')).toBeNull();
    expect(lastParams().payeeIds).toBeUndefined();
  });

  it('ignores values the list does not offer', () => {
    renderAt('/transactions?range=century&types=bogus&min=-3&payee=../x');
    const params = lastParams();
    expect(params.types).toBeUndefined();
    expect(params.minAmountMinor).toBeUndefined();
    expect(params.payeeIds).toBeUndefined();
    expect((screen.getByLabelText('Date range') as HTMLSelectElement).value).toBe('this_month');
  });

  it('applies a new search sent while the list is already open', () => {
    const go = renderAt('/transactions?q=old');
    expect((screen.getByLabelText('Search transactions') as HTMLInputElement).value).toBe('old');
    go('/transactions?types=income&max=100000');
    expect(lastParams().types).toEqual(['income']);
    expect(lastParams().maxAmountMinor).toBe(100000);
    expect((screen.getByLabelText('Search transactions') as HTMLInputElement).value).toBe('');
  });
});

describe('<TransactionsPage> detail sheet freshness', () => {
  const entry = (rev: number) => ({
    id: 't1', rev, type: 'expense', amountMinor: 59900, currency: 'INR', date: '2026-10-03T09:00:00.000Z', description: 'Jio recharge',
    postings: [], tags: [], attachments: [], isRecurringInstance: false, createdAt: '', updatedAt: '',
  });

  it('shows the refetched entry, not the copy taken when it was opened', () => {
    listItems = [entry(1)];
    const { rerender } = render(
      <MemoryRouter>
        <ToastProvider>
          <TransactionsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('Jio recharge'));
    expect(screen.getByTestId('sheet').textContent).toBe('Jio recharge rev 1');
    listItems = [entry(2)]; // the list refetched after a change
    rerender(
      <MemoryRouter>
        <ToastProvider>
          <TransactionsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('sheet').textContent).toBe('Jio recharge rev 2');
  });
});
