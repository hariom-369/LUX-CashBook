import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TrashItemDto } from '@khata/shared';

let items: TrashItemDto[] = [];
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, api: { ...actual.api, post: vi.fn(), delete: vi.fn() } };
});
vi.mock('../../lib/queries5', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/queries5')>();
  return {
    ...actual,
    useTrash: () => ({ data: { items, total: items.length, page: 1, limit: 25, totalPages: 1, hasMore: false }, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }),
    useInvalidateAfterTrash: () => () => {},
  };
});

import { api } from '../../lib/api';
import { ToastProvider } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { TrashPage } from './TrashPage';

const post = vi.mocked(api.post);
const del = vi.mocked(api.delete);

const item = (over: Partial<TrashItemDto>): TrashItemDto => ({
  id: 'x', type: 'transaction', name: 'Lunch', deletedAt: '2026-10-20T10:00:00.000Z', expiresAt: '2026-11-19T10:00:00.000Z', daysRemaining: 28, ...over,
});

function setRole(myRole: 'owner' | 'member') {
  act(() => useAuthStore.setState({ activeWorkspaceId: 'w1', workspaces: [{ id: 'w1', myRole }] } as never));
}
function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <TrashPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  items = [
    item({ id: 't1', name: 'Lunch', amountMinor: 25_000, currency: 'INR', transactionType: 'expense', date: '2026-10-19T12:00:00.000Z' }),
    item({ id: 'b1', type: 'budget', name: 'Food', daysRemaining: 2 }),
  ];
  setRole('owner');
});
afterEach(() => cleanup());

describe('<TrashPage>', () => {
  it('lists each item with its type and its countdown, and warns when time is short', () => {
    renderPage();
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]!).getByText('Lunch')).toBeTruthy();
    expect(within(rows[0]!).getAllByText('28 days left').length).toBeGreaterThan(0);
    expect(within(rows[1]!).getByText('Budget')).toBeTruthy();
    expect(within(rows[1]!).getAllByText('2 days left')[0]!.className).toContain('warning');
    expect(screen.getByText(/permanently deleted 30 days after you delete them/)).toBeTruthy();
  });

  it('restores one item, or every selected one', async () => {
    post.mockResolvedValue([{ type: 'transaction', id: 't1', ok: true }]);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Restore Lunch' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/trash/restore', { items: [{ type: 'transaction', id: 't1' }] }, expect.anything()));

    post.mockResolvedValue([{ type: 'transaction', id: 't1', ok: true }, { type: 'budget', id: 'b1', ok: true }]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore selected' }));
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith('/trash/restore', { items: [{ type: 'transaction', id: 't1' }, { type: 'budget', id: 'b1' }] }, expect.anything()),
    );
  });

  it('asks before deleting forever, and sends the confirmation the server requires', async () => {
    del.mockResolvedValue({});
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Food forever' }));
    expect(del).not.toHaveBeenCalled();
    expect(screen.getByText('Delete “Food” forever?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete forever' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/trash/budget/b1', { confirm: true }));
  });

  it('asks before emptying Trash', async () => {
    post.mockResolvedValue({ deleted: 2, kept: 0 });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Empty Trash' }));
    expect(post).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Empty Trash?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Empty Trash' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/trash/empty', { confirm: true }));
  });

  it('offers restore but not permanent deletion to a member', () => {
    setRole('member');
    renderPage();
    expect(screen.getByRole('button', { name: 'Restore Lunch' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete Food forever' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Empty Trash' })).toBeNull();
  });

  it('explains an empty Trash', () => {
    items = [];
    renderPage();
    expect(screen.getByText('Trash is empty')).toBeTruthy();
  });
});
