import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, api: { ...actual.api, post: vi.fn(), patch: vi.fn(), delete: vi.fn(), get: vi.fn() } };
});
vi.mock('../../lib/queries', () => ({ useInvalidateLedger: () => () => {} }));

import { api, ApiRequestError } from '../../lib/api';
import { AccountFormSheet } from './AccountFormSheet';
import { ToastProvider } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/auth.store';
import { useOfflineStore } from '../../stores/offline.store';
import { __resetOfflineDbForTests, listOutbox } from '../../lib/offlineDb';

const post = vi.mocked(api.post);
const offline = () => new ApiRequestError(0, { code: 'NETWORK_ERROR', message: 'offline' });

function renderForm(onClose = vi.fn()) {
  render(
    <ToastProvider>
      <AccountFormSheet open account={null} onClose={onClose} />
    </ToastProvider>,
  );
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Travel wallet' } });
  return onClose;
}
const save = () => fireEvent.click(screen.getByRole('button', { name: /^(Add account|Save)/i }));

beforeEach(async () => {
  await __resetOfflineDbForTests();
  vi.clearAllMocks();
  act(() => useAuthStore.setState({ activeWorkspaceId: 'ws1', user: { id: 'u1', preferences: {} } } as never));
});
afterEach(() => {
  cleanup();
  act(() => {
    useAuthStore.setState({ user: null } as never);
    useOfflineStore.setState({ pendingCount: 0 });
  });
});

describe('creating an account while offline (§Phase 15 follow-up)', () => {
  it('queues the create under an idempotency key, tells the user, and closes — it does not claim the account exists', async () => {
    post.mockRejectedValueOnce(offline());
    const onClose = renderForm();
    save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const [item] = await listOutbox();
    expect(item).toMatchObject({ method: 'POST', path: '/accounts', workspaceId: 'ws1', userId: 'u1' });
    expect(item!.idempotencyKey).toBeTruthy();
    expect((item!.body as { name: string }).name).toBe('Travel wallet');
    expect(await screen.findByText('Saved on this device')).toBeTruthy();
    expect(screen.queryByText('Account added')).toBeNull();
    expect(useOfflineStore.getState().pendingCount).toBe(1);
  });

  it('queues under exactly the key the failed live attempt used (so a lost reply cannot create it twice)', async () => {
    post.mockRejectedValueOnce(offline());
    renderForm();
    save();
    await waitFor(async () => expect(await listOutbox()).toHaveLength(1));
    const sent = (post.mock.calls[0]![2]!.headers as Record<string, string>)['Idempotency-Key'];
    expect((await listOutbox())[0]!.idempotencyKey).toBe(sent);
  });

  it('online, it saves normally with the usual confirmation and queues nothing', async () => {
    post.mockResolvedValueOnce({ id: 'a1' });
    const onClose = renderForm();
    save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await screen.findByText('Account added')).toBeTruthy();
    expect(await listOutbox()).toHaveLength(0);
  });

  it('a real server rejection is shown, not queued', async () => {
    post.mockRejectedValueOnce(new ApiRequestError(409, { code: 'ACCOUNT_NAME_TAKEN', message: 'You already have an account called that.' }));
    const onClose = renderForm();
    save();
    expect(await screen.findByText('You already have an account called that.')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(await listOutbox()).toHaveLength(0);
  });
});
