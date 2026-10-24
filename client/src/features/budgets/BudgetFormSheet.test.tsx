import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const createOrQueue = vi.fn();
const patchOrQueue = vi.fn();
vi.mock('../../hooks/useOfflineCreate', () => ({ useOfflineCreate: () => createOrQueue }));
vi.mock('../../hooks/useOfflinePatch', () => ({ useOfflinePatch: () => patchOrQueue }));
vi.mock('../../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/queries')>();
  return { ...actual, useAccounts: () => ({ data: [] }), useCategories: () => ({ data: [{ id: 'c1', name: 'Food', children: [] }] }) };
});
vi.mock('../../lib/queries3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/queries3')>();
  return { ...actual, useInvalidatePlanning: () => () => {} };
});

import { ToastProvider } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { BudgetFormSheet } from './BudgetFormSheet';

function renderForm() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <BudgetFormSheet open budget={null} onClose={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  createOrQueue.mockResolvedValue(true);
  act(() => useAuthStore.setState({ activeWorkspaceId: 'w1', user: null } as never));
});
afterEach(() => cleanup());

describe('<BudgetFormSheet> alert thresholds', () => {
  it('starts at 75, 90 and 100%, and sends the thresholds chosen', async () => {
    renderForm();
    const pressed = () => screen.getAllByRole('button', { pressed: true }).map((b) => b.textContent).filter((text) => text?.endsWith('%'));
    expect(pressed()).toEqual(['75%', '90%', '100%']);

    fireEvent.click(screen.getByRole('button', { name: '90%' }));
    fireEvent.click(screen.getByRole('button', { name: '50%' }));
    fireEvent.change(screen.getByLabelText(/Budget amount/), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create budget' }));

    await waitFor(() => expect(createOrQueue).toHaveBeenCalled());
    expect(createOrQueue.mock.calls[0]![1]).toMatchObject({ alertThresholds: [50, 75, 100] });
  });

  it('can turn alerts off for a budget', () => {
    renderForm();
    for (const pct of ['75%', '90%', '100%']) fireEvent.click(screen.getByRole('button', { name: pct }));
    expect(screen.getByText(/No alerts for this budget/)).toBeTruthy();
  });
});
