import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { API_CACHE } from './cacheNames';

/**
 * The offline outbox (§39, extended §Phase 15).
 *
 * This is the half of offline support the service worker's HTTP cache cannot
 * provide: a place for a *write* to live between "the user pressed Save while
 * offline" and "the request actually reached the server". Each queued item
 * carries the exact request the API expects, plus the idempotency key it was
 * built with — the same key the server already de-duplicates on for a retried
 * POST (invariant I9 / §51) — so replaying the outbox after a flaky reconnect can
 * never create the same transaction twice.
 *
 * Originally scoped to one case (quick-add transaction creates — §39's literal
 * ask, and the one where losing the user's input is worst). §Phase 15 widened
 * `method` so any mutation can queue — `lib/offlineMutation.ts#submitOrQueue` is
 * the generic helper a call site adopts; adoption is still partial (see
 * `docs/ROADMAP_PHASE15_NOTES.md`), but the queue itself no longer refuses a
 * PATCH/PUT/DELETE the way it did before this phase.
 */

export interface OutboxItem {
  id: string;
  createdAt: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body: Record<string, unknown>;
  workspaceId: string;
  /**
   * Who queued it. Only that user's session ever replays it, so a queued entry
   * can't be sent — or reported on — under someone else's sign-in on a shared
   * device. Items queued before this field existed have none and are treated as
   * the current user's, which is what the app always did.
   */
  userId?: string;
  /**
   * Sent as the `Idempotency-Key` header on every attempt (§Phase 15 follow-up), so the
   * server applies a queued create exactly once even if an earlier attempt reached it and
   * only the response was lost. Generated before the *first* attempt and kept for life.
   */
  idempotencyKey?: string;
  /** Set once a sync attempt fails, so the UI can show what went wrong. */
  lastError?: string;
  attempts: number;
  /**
   * The revision this edit was based on (§Phase 15) — present only for a
   * PATCH that carries optimistic concurrency. Lets a replay tell "the server
   * rejected this because someone else changed it first" (a real conflict,
   * surfaced to the user) apart from any other 4xx (a genuine validation
   * failure, discarded).
   */
  rev?: number;
  /**
   * Set once a replay discovers the item's `rev` is stale — the queued edit is
   * kept, never silently dropped or silently overwritten; a conflict only
   * clears once the user explicitly resolves it (`ConflictDialog`).
   */
  conflict?: { serverVersion: unknown; detectedAt: string };
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

/** Queued items that belong to `userId`, oldest first (see `OutboxItem.userId`). */
export async function listOutboxFor(userId: string): Promise<OutboxItem[]> {
  return (await listOutbox()).filter((item) => !item.userId || item.userId === userId);
}

export async function outboxCountFor(userId: string): Promise<number> {
  return (await listOutboxFor(userId)).length;
}

/** Queued items of `userId`'s that a replay has found conflict with the server's current version. */
export async function listConflictsFor(userId: string): Promise<OutboxItem[]> {
  return (await listOutboxFor(userId)).filter((item) => item.conflict);
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
 * Forget every cached *read* on this device: the session snapshot and other
 * entries in the `cache` store, and the service worker's cache of API responses
 * (balances, transactions, people, reports…).
 *
 * Called on sign-out, when a session ends, and before a fresh sign-in, so the
 * next person to use this browser — online or offline — is never shown the
 * previous user's figures. Queued *writes* (the outbox) are deliberately kept:
 * they are unsynced financial records, tagged with their owner, and replayed only
 * by that user's next session.
 */
export async function wipeCachedReads(): Promise<void> {
  const db = await getDb();
  await db.clear('cache');
  if (typeof caches !== 'undefined') {
    await caches.delete(API_CACHE);
  }
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
