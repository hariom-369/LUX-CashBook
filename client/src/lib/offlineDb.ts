import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * The offline outbox (§39).
 *
 * This is the half of offline support the service worker's HTTP cache cannot
 * provide: a place for a *write* to live between "the user pressed Save while
 * offline" and "the request actually reached the server". Each queued item
 * carries the exact request the API expects, plus the idempotency key it was
 * built with — the same key the server already de-duplicates on for a retried
 * POST (invariant I9 / §51) — so replaying the outbox after a flaky reconnect can
 * never create the same transaction twice.
 *
 * Scoped to one small, well-defined case rather than a generic "queue any
 * mutation" system: quick-add transactions, which is the action §39 explicitly
 * calls out ("Users should be able to... add transactions... while offline") and
 * the one where losing the user's input is worst. Edits and deletes made offline
 * are out of scope for this build — see docs/PHASE5_NOTES.md.
 */

export interface OutboxItem {
  id: string;
  createdAt: string;
  method: 'POST';
  path: string;
  body: Record<string, unknown>;
  workspaceId: string;
  /** Set once a sync attempt fails, so the UI can show what went wrong. */
  lastError?: string;
  attempts: number;
}

interface KhataDb extends DBSchema {
  outbox: {
    key: string;
    value: OutboxItem;
    indexes: { 'by-created': string };
  };
  /** A read-through cache of the last-known-good response for a handful of GETs. */
  cache: {
    key: string;
    value: { key: string; data: unknown; cachedAt: string };
  };
}

let dbPromise: Promise<IDBPDatabase<KhataDb>> | null = null;

function getDb(): Promise<IDBPDatabase<KhataDb>> {
  dbPromise ??= openDB<KhataDb>('khata-offline', 1, {
    upgrade(db) {
      const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
      outbox.createIndex('by-created', 'createdAt');
      db.createObjectStore('cache', { keyPath: 'key' });
    },
  });
  return dbPromise;
}

export async function enqueueOutboxItem(item: Omit<OutboxItem, 'id' | 'createdAt' | 'attempts'>): Promise<OutboxItem> {
  const full: OutboxItem = {
    ...item,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  const db = await getDb();
  await db.put('outbox', full);
  return full;
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const db = await getDb();
  return db.getAllFromIndex('outbox', 'by-created');
}

export async function removeOutboxItem(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('outbox', id);
}

export async function updateOutboxItem(id: string, patch: Partial<OutboxItem>): Promise<void> {
  const db = await getDb();
  const existing = await db.get('outbox', id);
  if (!existing) return;
  await db.put('outbox', { ...existing, ...patch });
}

export async function outboxCount(): Promise<number> {
  const db = await getDb();
  return db.count('outbox');
}

/**
 * A small local cache for offline *reads* that the service worker's HTTP cache
 * doesn't cover — chiefly the currently-active workspace id and user profile,
 * which the app needs before it can even decide what to render, before any
 * network request has had a chance to succeed or fail.
 */
export async function cacheSet(key: string, data: unknown): Promise<void> {
  const db = await getDb();
  await db.put('cache', { key, data, cachedAt: new Date().toISOString() });
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const row = await db.get('cache', key);
  return (row?.data as T) ?? null;
}

/**
 * Test-only: empty both stores through the existing connection.
 *
 * Deliberately not `indexedDB.deleteDatabase()` between tests — the module holds
 * one long-lived connection (`dbPromise`), and closing the database out from
 * under it mid-suite trades a clean reset for connections left permanently
 * "blocked". Clearing the stores through the connection this module already owns
 * gets the same isolation without that failure mode.
 */
export async function __resetOfflineDbForTests(): Promise<void> {
  const db = await getDb();
  await Promise.all([db.clear('outbox'), db.clear('cache')]);
}
