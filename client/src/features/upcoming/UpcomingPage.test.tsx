import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UpcomingPaymentDto, UpcomingPaymentsDto } from '@khata/shared';

let response: UpcomingPaymentsDto;
const requestedDays = vi.fn();
vi.mock('../../lib/queries5', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/queries5')>();
  return {
    ...actual,
    useUpcomingPayments: (days: number) => {
      requestedDays(days);
      return { data: response, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
    },
  };
});

import { useAuthStore } from '../../stores/auth.store';
import { UpcomingPage } from './UpcomingPage';

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(12, 0, 0, 0);
  return d;
};
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const item = (over: Partial<UpcomingPaymentDto> & { offset: number }): UpcomingPaymentDto => {
  const due = day(over.offset);
  return {
    key: `k-${over.title}-${over.offset}`, source: 'recurring', sourceId: 's', title: 'x', amountMinor: 100_00, direction: 'out',
    dueDate: due.toISOString(), dateKey: key(due), status: 'upcoming', link: '/recurring', ...over,
  };
};

beforeEach(() => {
  requestedDays.mockClear();
  act(() => useAuthStore.setState({ activeWorkspaceId: 'w1', user: null } as never));
  response = {
    asOf: new Date().toISOString(), from: '', to: '', truncated: false,
    items: [
      item({ title: 'Internet', offset: -2, status: 'overdue', autoPost: false }),
      item({ title: 'Rent', offset: 3, autoPost: true, amountMinor: 12_000_00, accountName: 'Bank' }),
      item({ title: 'EMI', offset: 20, source: 'installment', counterparty: 'Ravi', link: '/people/p1' }),
      item({ title: 'Electricity', offset: -1, status: 'paid' }),
    ],
    totals: { dueOutMinor: 12_200_00, dueInMinor: 0, overdueCount: 1, withoutAmountCount: 0 },
  };
});
afterEach(() => cleanup());

function renderPage() {
  render(
    <MemoryRouter>
      <UpcomingPage />
    </MemoryRouter>,
  );
}

describe('<UpcomingPage>', () => {
  it('groups what is due into overdue, this week and later, with recent payments kept apart', () => {
    renderPage();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Overdue · 1', 'This week · 1', 'Later · 1', 'Recently paid · 1']);

    const paid = within(screen.getByRole('region', { name: 'Recently paid · 1' }));
    expect(paid.getByText('Electricity')).toBeTruthy();
    expect(paid.getByText('Paid')).toBeTruthy();
  });

  it('says whether a recurring payment posts by itself, and links each item to where it is managed', () => {
    renderPage();
    expect(screen.getByText('Posts automatically')).toBeTruthy();
    expect(screen.getByText('Needs confirming')).toBeTruthy();
    expect(screen.getByRole('link', { name: /EMI/ }).getAttribute('href')).toBe('/people/p1');
  });

  it('filters by kind and changes how far ahead it looks', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'loans' } });
    expect(screen.queryByText('Rent')).toBeNull();
    expect(screen.getByText('EMI')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('How far ahead'), { target: { value: '90' } });
    expect(requestedDays).toHaveBeenLastCalledWith(90);
  });

  it('explains that nothing here is a payment', () => {
    renderPage();
    expect(screen.getByText(/These are scheduled, not paid/)).toBeTruthy();
  });
});
