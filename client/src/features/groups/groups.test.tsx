import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ExpenseGroupDto, GroupSettlementSuggestionDto } from '@khata/shared';

const createOrQueue = vi.fn();
const people = [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }];
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, api: { ...actual.api, post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});
vi.mock('../../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/queries')>();
  return {
    ...actual,
    useAccounts: () => ({ data: [{ id: 'acc1', name: 'Bank' }] }),
    useCategories: () => ({ data: [] }),
    usePeople: () => ({ data: people }),
  };
});
vi.mock('../../lib/queries3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/queries3')>();
  return { ...actual, useInvalidateGroup: () => () => {} };
});
vi.mock('../../hooks/useOfflineCreate', () => ({ useOfflineCreate: () => createOrQueue }));

import { api } from '../../lib/api';
import { ToastProvider } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { AddGroupExpenseSheet } from './AddGroupExpenseSheet';
import { GroupPaymentSheet } from './GroupPaymentSheet';
import { GroupFormSheet } from './GroupFormSheet';
import { DeleteGroupDialog } from './DeleteGroupDialog';

const post = vi.mocked(api.post);

const group: ExpenseGroupDto = {
  id: 'g1', workspaceId: 'w1', name: 'Goa Trip', memberPersonIds: ['p1', 'p2'], memberNames: ['Alice', 'Bob'], isActive: true, createdAt: '',
};

function wrap(ui: React.ReactNode) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  createOrQueue.mockResolvedValue(true);
  post.mockResolvedValue({});
  act(() => useAuthStore.setState({ activeWorkspaceId: 'w1' } as never));
});
afterEach(() => cleanup());

describe('<AddGroupExpenseSheet>', () => {
  it('records an expense a member paid, excluding you, without asking for one of your accounts', async () => {
    wrap(<AddGroupExpenseSheet group={group} open onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Total amount paid/), { target: { value: '600' } });
    fireEvent.change(screen.getByLabelText(/Paid by/), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'You' }));

    expect(screen.queryByLabelText(/Record your share in/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }));

    await waitFor(() => expect(createOrQueue).toHaveBeenCalled());
    const [path, body] = createOrQueue.mock.calls[0]!;
    expect(path).toBe('/groups/g1/expenses');
    expect(body).toMatchObject({
      paidByPersonId: 'p1',
      accountId: null,
      totalAmountMinor: 60_000,
      splitMethod: 'equal',
      participants: [{ personId: 'p1' }, { personId: 'p2' }],
    });
  });

  it('asks where to record your share when a member paid and you shared it', () => {
    wrap(<AddGroupExpenseSheet group={group} open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Total amount paid/), { target: { value: '900' } });
    fireEvent.change(screen.getByLabelText(/Paid by/), { target: { value: 'p2' } });
    expect(screen.getByLabelText(/Record your share in/)).toBeTruthy();
  });

  it('will not submit percentages that do not add up to 100', () => {
    wrap(<AddGroupExpenseSheet group={group} open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Total amount paid/), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'By percentage' }));
    fireEvent.change(screen.getByLabelText('Percentage for You'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Percentage for Alice'), { target: { value: '30' } });

    expect(screen.getByText(/Adds up to 80% of 100%/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add expense' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Percentage for Bob'), { target: { value: '20' } });
    expect((screen.getByRole('button', { name: 'Add expense' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('<GroupFormSheet>', () => {
  const addName = (value: string) => {
    fireEvent.change(screen.getByLabelText('Add someone new'), { target: { value } });
    fireEvent.keyDown(screen.getByLabelText('Add someone new'), { key: 'Enter' });
  };

  it('adds a new person by name while creating a group, creating them only on save', async () => {
    post.mockImplementation(async (path: string) => (path === '/people' ? { id: 'p9', name: 'Chetan' } : {}) as never);
    wrap(<GroupFormSheet open onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Alwar' } });
    addName('Chetan');
    expect(screen.getByText('Chetan')).toBeTruthy();
    expect(post).not.toHaveBeenCalled(); // nothing is created until the group is saved

    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    await waitFor(() => expect(createOrQueue).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/people', { name: 'Chetan' });
    expect(createOrQueue).toHaveBeenCalledWith('/groups', { name: 'Alwar', memberPersonIds: ['p9'] });
  });

  it('ticks someone already in People instead of creating them twice', async () => {
    wrap(<GroupFormSheet open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Trip' } });
    addName('alice');
    expect((screen.getByRole('checkbox', { name: 'Alice' }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    await waitFor(() => expect(createOrQueue).toHaveBeenCalledWith('/groups', { name: 'Trip', memberPersonIds: ['p1'] }));
    expect(post).not.toHaveBeenCalledWith('/people', expect.anything());
  });

  it('adds a new person to an existing group', async () => {
    post.mockImplementation(async (path: string) => (path === '/people' ? { id: 'p9', name: 'Chetan' } : {}) as never);
    wrap(<GroupFormSheet open onClose={() => {}} group={{ ...group, memberPersonIds: ['p1'], memberNames: ['Alice'] }} />);

    addName('Chetan');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/groups/g1/members', { personIds: ['p9'] }));
  });
});

describe('<DeleteGroupDialog>', () => {
  it('asks before deleting, and deletes only once confirmed', async () => {
    const del = vi.mocked(api.delete).mockResolvedValue({});
    const deleted = vi.fn();
    wrap(<DeleteGroupDialog group={{ id: 'g1', name: 'Alwar' }} onClose={() => {}} onDeleted={deleted} />);

    expect(screen.getByText('Delete “Alwar”?')).toBeTruthy();
    expect(screen.getByText(/stays in your accounts and People ledger/)).toBeTruthy();
    expect(del).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete group' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/groups/g1'));
    await waitFor(() => expect(deleted).toHaveBeenCalled());
  });

  it('warns that money is still owed when the group is not settled up', () => {
    wrap(<DeleteGroupDialog group={{ id: 'g1', name: 'Alwar' }} unsettled onClose={() => {}} />);
    expect(screen.getByText(/isn’t settled up yet/)).toBeTruthy();
  });
});

describe('<GroupPaymentSheet>', () => {
  const suggestions: GroupSettlementSuggestionDto[] = [
    { fromPersonId: 'p1', toPersonId: null, amountMinor: 100_000 },
    { fromPersonId: 'p1', toPersonId: 'p2', amountMinor: 30_000 },
  ];

  it('prefills a suggested payment to you and records part of it into an account', async () => {
    wrap(<GroupPaymentSheet group={group} open onClose={() => {}} suggestion={suggestions[0]!} suggestions={suggestions} />);

    expect(screen.getByLabelText(/Received into/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe('/groups/g1/settlements');
    expect(body).toMatchObject({ fromPersonId: 'p1', toPersonId: null, amountMinor: 40_000, accountId: 'acc1' });
  });

  it('records a payment between two other members without any account', async () => {
    wrap(<GroupPaymentSheet group={group} open onClose={() => {}} suggestion={suggestions[1]!} suggestions={suggestions} />);

    expect(screen.queryByLabelText(/Received into|Paid from/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toMatchObject({ fromPersonId: 'p1', toPersonId: 'p2', amountMinor: 30_000, accountId: null });
  });
});
