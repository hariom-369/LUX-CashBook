import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  // The server takes a moment to record the switch — the window the bug lived in.
  return { ...actual, api: { ...actual.api, post: vi.fn(() => new Promise((r) => setTimeout(() => r({}), 50))) } };
});

import { useAuthStore } from '../stores/auth.store';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

/** A screen that loads its data keyed by the active workspace, like every real one. */
function Screen() {
  const ws = useAuthStore((s) => s.activeWorkspaceId ?? 'none');
  const { data, isLoading } = useQuery({
    queryKey: [ws, 'dashboard'],
    queryFn: async () => {
      await new Promise((r) => setTimeout(r, 10));
      return `data for ${ws}`;
    },
  });
  return <p>{isLoading ? 'loading…' : data}</p>;
}

const workspaces = [
  { id: 'w1', name: 'Personal', mode: 'personal', currency: 'INR' },
  { id: 'w2', name: 'Family', mode: 'personal', currency: 'USD' },
];

beforeEach(() => {
  act(() => useAuthStore.setState({ status: 'authenticated', workspaces, activeWorkspaceId: 'w1' } as never));
});
afterEach(() => cleanup());

describe('<WorkspaceSwitcher>', () => {
  it('loads the new workspace\'s data straight away, without a reload', async () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <WorkspaceSwitcher />
          <Screen />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('data for w1');

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: /Family/ }));

    await waitFor(() => expect(screen.getByText('data for w2')).toBeTruthy(), { timeout: 2000 });
    // Once the server has recorded the switch, nothing from the old workspace is left behind.
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ['w1'] })).toHaveLength(0));
  });
});
