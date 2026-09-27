import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  __resetOfflineDbForTests,
  cacheGet,
  cacheSet,
  enqueueOutboxItem,
  listOutbox,
  listOutboxFor,
  outboxCount,
  outboxCountFor,
  removeOutboxItem,
  updateOutboxItem,
  wipeCachedReads,
} from './offlineDb';
import { API_CACHE } from './cacheNames';

/**
 * The offline outbox is the one piece of client state where a bug means real
 * data loss — a transaction someone recorded offline silently vanishing. These
 * tests run against `fake-indexeddb` rather than mocking the module, so they
 * exercise the actual IndexedDB code path the browser will run.
 */
describe('offline outbox', () => {
  beforeEach(async () => {
    await __resetOfflineDbForTests();
  });

  it('queues an item and can list it back in creation order', async () => {
    const first = await enqueueOutboxItem({
      method: 'POST',
      path: '/transactions',
      body: { amountMinor: 100 },
      workspaceId: 'ws1',
    });
    const second = await enqueueOutboxItem({
      method: 'POST',
      path: '/transactions',
      body: { amountMinor: 200 },
      workspaceId: 'ws1',
    });

    const items = await listOutbox();
    expect(items.map((i) => i.id)).toEqual([first.id, second.id]);
    expect(items[0]!.attempts).toBe(0);
  });

  it('reports an accurate count', async () => {
    expect(await outboxCount()).toBe(0);
    await enqueueOutboxItem({ method: 'POST', path: '/transactions', body: {}, workspaceId: 'ws1' });
    await enqueueOutboxItem({ method: 'POST', path: '/transactions', body: {}, workspaceId: 'ws1' });
    expect(await outboxCount()).toBe(2);
  });

  it('removes exactly the item asked for, leaving the rest untouched', async () => {
    const a = await enqueueOutboxItem({ method: 'POST', path: '/transactions', body: { tag: 'a' }, workspaceId: 'ws1' });
    const b = await enqueueOutboxItem({ method: 'POST', path: '/transactions', body: { tag: 'b' }, workspaceId: 'ws1' });

    await removeOutboxItem(a.id);

    const remaining = await listOutbox();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(b.id);
  });

  it('tracks retry attempts and the last error without losing the original body', async () => {
    const item = await enqueueOutboxItem({
      method: 'POST',
      path: '/transactions',
      body: { amountMinor: 500, idempotencyKey: 'qa-abc123' },
      workspaceId: 'ws1',
    });

    await updateOutboxItem(item.id, { attempts: 1, lastError: 'Network request failed' });

    const [updated] = await listOutbox();
    expect(updated!.attempts).toBe(1);
    expect(updated!.lastError).toBe('Network request failed');
    // The idempotency key survives a partial-failure update — this is what stops
    // a retried sync from ever creating a duplicate transaction on the server.
    expect(updated!.body.idempotencyKey).toBe('qa-abc123');
  });

  it('updating a non-existent item is a safe no-op', async () => {
    await expect(updateOutboxItem('does-not-exist', { attempts: 5 })).resolves.toBeUndefined();
    expect(await outboxCount()).toBe(0);
  });

  it('persists a distinct idempotency key per queued item even when queued in the same tick', async () => {
    const [a, b] = await Promise.all([
      enqueueOutboxItem({ method: 'POST', path: '/transactions', body: {}, workspaceId: 'ws1' }),
      enqueueOutboxItem({ method: 'POST', path: '/transactions', body: {}, workspaceId: 'ws1' }),
    ]);
    expect(a.id).not.toBe(b.id);
    expect(await outboxCount()).toBe(2);
  });
});

describe('offline read cache', () => {
  beforeEach(async () => {
    await __resetOfflineDbForTests();
  });

  it('round-trips arbitrary JSON-serialisable data', async () => {
    await cacheSet('active-workspace', { id: 'ws1', name: 'Personal' });
    const value = await cacheGet<{ id: string; name: string }>('active-workspace');
    expect(value).toEqual({ id: 'ws1', name: 'Personal' });
  });

  it('returns null for a key that was never cached', async () => {
    expect(await cacheGet('nothing-here')).toBeNull();
  });
});

describe('per-user outbox (shared devices)', () => {
  beforeEach(async () => {
    await __resetOfflineDbForTests();
  });

  it("lists and counts only the given user's entries, plus untagged legacy ones", async () => {
    const mine = await enqueueOutboxItem({ method: 'POST', path: '/transactions', body: {}, workspaceId: 'ws1', userId: 'u1' });
    await enqueueOutboxItem({ method: 'POST', path: '/transactions', body: {}, workspaceId: 'ws9', userId: 'u2' });
    const legacy = await enqueueOutboxItem({ method: 'POST', path: '/transactions', body: {}, workspaceId: 'ws1' });

    expect((await listOutboxFor('u1')).map((i) => i.id).sort()).toEqual([mine.id, legacy.id].sort());
    expect(await outboxCountFor('u1')).toBe(2);
    expect(await outboxCountFor('u2')).toBe(2);
    expect(await outboxCount()).toBe(3);
  });

  it('keeps the workspace each entry was recorded in', async () => {
    await enqueueOutboxItem({ method: 'POST', path: '/transactions', body: {}, workspaceId: 'ws-a', userId: 'u1' });
    const [item] = await listOutboxFor('u1');
    expect(item!.workspaceId).toBe('ws-a');
  });
});

describe('wiping cached reads on sign-out', () => {
  const deleted: string[] = [];

  beforeEach(async () => {
    await __resetOfflineDbForTests();
    deleted.length = 0;
    vi.stubGlobal('caches', { delete: async (name: string) => (deleted.push(name), true) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("empties the read cache and the service worker's API cache", async () => {
    await cacheSet('last-known-session', { user: { id: 'u1' } });
    await wipeCachedReads();
    expect(await cacheGet('last-known-session')).toBeNull();
    expect(deleted).toEqual([API_CACHE]);
  });

  it('never touches queued writes — unsynced entries survive sign-out', async () => {
    await enqueueOutboxItem({ method: 'POST', path: '/transactions', body: { amountMinor: 500 }, workspaceId: 'ws1', userId: 'u1' });
    await wipeCachedReads();
    expect(await outboxCount()).toBe(1);
  });
});
