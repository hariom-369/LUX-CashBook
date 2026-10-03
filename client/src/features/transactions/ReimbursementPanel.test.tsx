import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TransactionDto } from '@khata/shared';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, api: { ...actual.api, patch: vi.fn(), getWithMeta: vi.fn() } };
});
vi.mock('../../lib/queries5', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/queries5')>();
  return { ...actual, useInvalidateOrganise: () => () => {} };
});

import { api, ApiRequestError } from '../../lib/api';
import { ReimbursementPanel } from './ReimbursementPanel';
import { ToastProvider } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { hi } from '../../i18n/messages/hi';

const patch = vi.mocked(api.patch);
const getWithMeta = vi.mocked(api.getWithMeta);

const txn = (over: Partial<TransactionDto> = {}) =>
  ({
    id: 't1', rev: 4, type: 'expense', amountMinor: 120000, currency: 'INR', date: '2026-10-01T09:00:00.000Z', description: 'Client lunch',
    postings: [], tags: [], attachments: [], isRecurringInstance: false, createdAt: '', updatedAt: '', ...over,
  }) as TransactionDto;
const claim = (status: string, extra: Record<string, unknown> = {}) => ({ status, updatedAt: '2026-10-02T09:00:00.000Z', ...extra }) as TransactionDto['reimbursement'];

function renderPanel(transaction: TransactionDto, onChanged = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <ReimbursementPanel transaction={transaction} onChanged={onChanged} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return onChanged;
}

beforeEach(() => {
  vi.clearAllMocks();
  patch.mockResolvedValue({});
  getWithMeta.mockResolvedValue({ data: { items: [] } } as never);
  act(() => useAuthStore.setState({ activeWorkspaceId: 'w1' } as never));
});
afterEach(() => {
  cleanup();
  act(() => useAuthStore.setState({ user: null } as never));
});

describe('<ReimbursementPanel> (§Phase 7)', () => {
  it('offers to start tracking an untracked expense, sending the rev it read', async () => {
    const changed = renderPanel(txn());
    fireEvent.click(screen.getByRole('button', { name: 'Track claim' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/transactions/t1/reimbursement', { status: 'pending', rev: 4 }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
  });

  it('shows where the claim stands and the one step forward and back', () => {
    renderPanel(txn({ reimbursement: claim('submitted') }));
    expect(screen.getByRole('list', { name: 'Claim stages' })).toBeTruthy();
    expect(screen.getAllByRole('listitem').find((li) => li.getAttribute('aria-current') === 'step')?.textContent).toBe('Submitted');
    expect(screen.getByRole('button', { name: 'Mark as Approved' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to Pending' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark as Paid' })).toBeNull(); // no jumping
    expect(screen.getByRole('button', { name: 'Stop tracking' })).toBeTruthy();
  });

  it('moves forward, back, and stops', async () => {
    renderPanel(txn({ reimbursement: claim('submitted') }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Approved' }));
    await waitFor(() => expect(patch).toHaveBeenLastCalledWith('/transactions/t1/reimbursement', { status: 'approved', rev: 4 }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Pending' }));
    await waitFor(() => expect(patch).toHaveBeenLastCalledWith('/transactions/t1/reimbursement', { status: 'pending', rev: 4 }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop tracking' }));
    await waitFor(() => expect(patch).toHaveBeenLastCalledWith('/transactions/t1/reimbursement', { status: 'none', rev: 4 }));
  });

  it('lets the payout be linked when marking paid, from the recent income entries', async () => {
    getWithMeta.mockResolvedValue({ data: { items: [{ id: 'in1', date: '2026-10-05T09:00:00.000Z', description: 'Acme refund', type: 'income' }] } } as never);
    renderPanel(txn({ reimbursement: claim('approved') }));
    const select = await screen.findByLabelText(/Link the money you received/);
    await screen.findByRole('option', { name: /Acme refund/ });
    fireEvent.change(select, { target: { value: 'in1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Paid' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/transactions/t1/reimbursement', { status: 'paid', rev: 4, payoutTransactionId: 'in1' }));
  });

  it('says it is paid, and whether a payout is linked, with no further step', () => {
    renderPanel(txn({ reimbursement: claim('paid', { payoutTransactionId: 'in1' }) }));
    expect(screen.getByText(/Paid — linked to the money you received/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Mark as/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Back to Approved' })).toBeTruthy();
  });

  it('shows the server\'s reason when a step is refused', async () => {
    patch.mockRejectedValueOnce(new ApiRequestError(409, { code: 'STALE_REVISION', message: 'This was changed somewhere else.' }));
    renderPanel(txn({ reimbursement: claim('pending') }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Submitted' }));
    expect((await screen.findByRole('alert')).textContent).toContain('changed somewhere else');
  });

  it('is not shown for anything but a live expense', () => {
    const { container } = render(<div />);
    cleanup();
    renderPanel(txn({ type: 'income' }));
    expect(screen.queryByText('Reimbursement')).toBeNull();
    cleanup();
    renderPanel(txn({ deletedAt: '2026-10-03T00:00:00.000Z' }));
    expect(screen.queryByText('Reimbursement')).toBeNull();
    expect(container).toBeTruthy();
  });

  it('is translated', () => {
    act(() => useAuthStore.setState({ activeWorkspaceId: 'w1', user: { preferences: { language: 'hi' } } } as never));
    renderPanel(txn({ reimbursement: claim('pending') }));
    expect(screen.getAllByText(hi['reimb.status.pending']!).length).toBeGreaterThan(0);
  });
});
