import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { QueryClient } from '@tanstack/react-query';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, api: { ...actual.api, post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), get: vi.fn() } };
});

import { api, ApiRequestError } from './api';
import { submitOrQueue } from './offlineMutation';
import { __resetOfflineDbForTests, enqueueOutboxItem, listConflictsFor, listOutbox, updateOutboxItem } from './offlineDb';
import { resolveOutboxConflict, retryDelayMs, syncOne } from '../hooks/useOfflineSync';

const post = vi.mocked(api.post);
const patch = vi.mocked(api.patch);
const del = vi.mocked(api.delete);
const get = vi.mocked(api.get);

const offlineError = () => new ApiRequestError(0, { code: 'NETWORK_ERROR', message: 'offline' });

beforeEach(async () => {
  await __resetOfflineDbForTests();
  vi.clearAllMocks();
});

describe('submitOrQueue', () => {
  it('returns the live result when online and queues nothing', async () => {
    patch.mockResolvedValueOnce({ id: 't1' });
    const res = await submitOrQueue({ method: 'PATCH', path: '/transactions/t1', body: { rev: 1 }, workspaceId: 'ws1', userId: 'u1', rev: 1 });
    expect(res).toEqual({ queued: false, data: { id: 't1' } });
    expect(await listOutbox()).toHaveLength(0);
  });

  it('queues a PATCH and a DELETE when offline, keeping the rev', async () => {
    patch.mockRejectedValueOnce(offlineError());
    del.mockRejectedValueOnce(offlineError());
    expect(await submitOrQueue({ method: 'PATCH', path: '/transactions/t1', body: { rev: 3 }, workspaceId: 'ws1', userId: 'u1', rev: 3 })).toEqual({ queued: true });
    expect(await submitOrQueue({ method: 'DELETE', path: '/transactions/t2', body: {}, workspaceId: 'ws1', userId: 'u1' })).toEqual({ queued: true });
    const items = await listOutbox();
    expect(items.map((i) => i.method)).toEqual(['PATCH', 'DELETE']);
    expect(items[0]!.rev).toBe(3);
  });

  it('rethrows a real server rejection instead of queueing it', async () => {
    patch.mockRejectedValueOnce(new ApiRequestError(422, { code: 'VALIDATION_ERROR', message: 'bad' }));
    await expect(submitOrQueue({ method: 'PATCH', path: '/x', body: {}, workspaceId: 'ws1', userId: 'u1' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await listOutbox()).toHaveLength(0);
  });
});

describe('resolveOutboxConflict', () => {
  async function conflicted() {
    const item = await enqueueOutboxItem({ method: 'PATCH', path: '/accounts/a1', body: { rev: 1, name: 'Mine' }, workspaceId: 'ws1', userId: 'u1', rev: 1 });
    await updateOutboxItem(item.id, { conflict: { serverVersion: { rev: 2, name: 'Theirs' }, detectedAt: new Date().toISOString() } });
    return (await listConflictsFor('u1'))[0]!;
  }

  it('discard removes the queued edit without touching the server', async () => {
    const item = await conflicted();
    const res = await resolveOutboxConflict(item, 'discard', 'u1', new QueryClient());
    expect(res.ok).toBe(true);
    expect(patch).not.toHaveBeenCalled();
    expect(await listOutbox()).toHaveLength(0);
  });

  it('overwrite resubmits on top of the server\'s latest rev, then clears the item', async () => {
    const item = await conflicted();
    get.mockResolvedValueOnce({ rev: 5, name: 'Theirs' });
    patch.mockResolvedValueOnce({});
    const res = await resolveOutboxConflict(item, 'overwrite', 'u1', new QueryClient());
    expect(res.ok).toBe(true);
    expect(patch).toHaveBeenCalledWith('/accounts/a1', { rev: 5, name: 'Mine' }, expect.anything());
    expect(await listOutbox()).toHaveLength(0);
  });

  it('stays conflicted if the record changed again mid-resolve', async () => {
    const item = await conflicted();
    get.mockResolvedValue({ rev: 6 });
    patch.mockRejectedValueOnce(new ApiRequestError(409, { code: 'STALE_REVISION', message: 'stale' }));
    const res = await resolveOutboxConflict(item, 'overwrite', 'u1', new QueryClient());
    expect(res.ok).toBe(false);
    expect(await listConflictsFor('u1')).toHaveLength(1);
  });
});

describe('online stale-revision conflicts', () => {
  it('keeps the edit as a conflict with the server version instead of throwing it away', async () => {
    patch.mockRejectedValueOnce(new ApiRequestError(409, { code: 'STALE_REVISION', message: 'stale' }));
    get.mockResolvedValueOnce({ rev: 9, name: 'Theirs' });
    const res = await submitOrQueue({ method: 'PATCH', path: '/accounts/a1', body: { rev: 1, name: 'Mine' }, workspaceId: 'ws1', userId: 'u1', rev: 1 });
    expect(res).toEqual({ queued: true, conflict: true });
    const [item] = await listConflictsFor('u1');
    expect(item!.body.name).toBe('Mine');
    expect((item!.conflict!.serverVersion as { rev: number }).rev).toBe(9);
  });
});

describe('retry back-off', () => {
  it('doubles from 5s and caps at 5 minutes', () => {
    expect([0, 1, 2, 3].map(retryDelayMs)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(retryDelayMs(10)).toBe(5 * 60_000);
    expect(retryDelayMs(50)).toBe(5 * 60_000);
  });
});

describe('queued creates carry an idempotency key (§Phase 15 follow-up)', () => {
  it('sends an Idempotency-Key with a POST, and none with an edit', async () => {
    post.mockResolvedValueOnce({ id: 'a1' });
    patch.mockResolvedValueOnce({ id: 'a1' });
    await submitOrQueue({ method: 'POST', path: '/accounts', body: { name: 'W' }, workspaceId: 'ws1', userId: 'u1' });
    await submitOrQueue({ method: 'PATCH', path: '/accounts/a1', body: { rev: 1 }, workspaceId: 'ws1', userId: 'u1', rev: 1 });
    const postHeaders = post.mock.calls[0]![2]!.headers as Record<string, string>;
    expect(postHeaders['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(postHeaders['X-Workspace-Id']).toBe('ws1');
    expect((patch.mock.calls[0]![2]!.headers as Record<string, string>)['Idempotency-Key']).toBeUndefined();
  });

  it('queues the create under the SAME key the failed online attempt used', async () => {
    post.mockRejectedValueOnce(offlineError());
    expect(await submitOrQueue({ method: 'POST', path: '/accounts', body: { name: 'W' }, workspaceId: 'ws1', userId: 'u1' })).toEqual({ queued: true });
    const attempted = (post.mock.calls[0]![2]!.headers as Record<string, string>)['Idempotency-Key'];
    const [item] = await listOutbox();
    expect(item!.idempotencyKey).toBe(attempted);
  });

  it('replays a queued create with its stored key and workspace', async () => {
    post.mockResolvedValueOnce({ id: 'a1' });
    const item = await enqueueOutboxItem({ method: 'POST', path: '/accounts', body: { name: 'W' }, workspaceId: 'ws9', userId: 'u1', idempotencyKey: 'stored-key-0001' });
    expect(await syncOne(item)).toBe('ok');
    expect(post.mock.calls[0]![2]!.headers).toEqual({ 'X-Workspace-Id': 'ws9', 'Idempotency-Key': 'stored-key-0001' });
  });

  it('keeps the entry queued while the server is still applying an earlier attempt', async () => {
    post.mockRejectedValueOnce(new ApiRequestError(409, { code: 'IDEMPOTENCY_IN_PROGRESS', message: 'busy' }));
    const item = await enqueueOutboxItem({ method: 'POST', path: '/accounts', body: {}, workspaceId: 'ws1', userId: 'u1', idempotencyKey: 'k-in-progress-1' });
    expect(await syncOne(item)).toBeInstanceOf(Error);
  });

  it('still discards a genuinely rejected create', async () => {
    post.mockRejectedValueOnce(new ApiRequestError(422, { code: 'VALIDATION_ERROR', message: 'bad' }));
    const item = await enqueueOutboxItem({ method: 'POST', path: '/accounts', body: {}, workspaceId: 'ws1', userId: 'u1', idempotencyKey: 'k-rejected-0001' });
    expect(await syncOne(item)).toBe('permanent');
  });
});
