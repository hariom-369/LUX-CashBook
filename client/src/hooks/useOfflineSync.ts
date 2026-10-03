import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiRequestError, api } from '../lib/api';
import { tNow, tNowPlural } from '../i18n';
import {
  listConflictsFor,
  listOutboxFor,
  outboxCountFor,
  removeOutboxItem,
  updateOutboxItem,
  type OutboxItem,
} from '../lib/offlineDb';
import { useOfflineStore } from '../stores/offline.store';
import { useOnlineStatus } from './useOnlineStatus';
import { useToast } from '../components/ui/Toast';
import { useAuthStore } from '../stores/auth.store';

/**
 * Flush the offline outbox when a connection is available (§39, extended §Phase 15).
 *
 * Runs the queue strictly in the order items were created — an edit queued
 * first should replay first, both because that is what the user would expect
 * from their own timeline and because a later item may depend on state (an
 * account balance, say) that only makes sense once an earlier one has landed.
 * Each item's `idempotencyKey` (already inside its `body` for a create) is
 * what makes a sync that gets interrupted and retried safe to just run again
 * from the top.
 *
 * A stale-revision conflict (someone else changed the same record while this
 * one sat queued) is never silently discarded and never silently overwrites —
 * the item stays queued, marked `conflict`, until `resolveOutboxConflict` is
 * called from `ConflictDialog`. Everything else permanently rejected (a
 * genuine validation failure) is discarded with a message, same as before
 * this phase.
 *
 * Instantiated exactly once, in `App.tsx` — it owns the online-connectivity
 * listener and the back-off retry timer, and a second instance would double
 * both. `resolveOutboxConflict` below is a standalone function precisely so
 * `ConflictDialog` doesn't need a second instance just to resolve one item.
 */
const BASE_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

/** Back-off schedule (§Phase 15): 5s doubling to a 5-minute cap. */
export function retryDelayMs(failureStreak: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** failureStreak);
}

export async function refreshOutboxCounts(userId: string | null): Promise<void> {
  if (!userId) {
    useOfflineStore.getState().setPendingCount(0);
    useOfflineStore.getState().setConflictCount(0);
    return;
  }
  const [pending, conflicts] = await Promise.all([outboxCountFor(userId), listConflictsFor(userId)]);
  useOfflineStore.getState().setPendingCount(pending);
  useOfflineStore.getState().setConflictCount(conflicts.length);
}

export function useOfflineSync(): { syncNow: () => Promise<void> } {
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const toast = useToast();
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const syncingRef = useRef(false);
  const failureStreakRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const justSyncedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRetry = useCallback((syncNowFn: () => void) => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    const delay = retryDelayMs(failureStreakRef.current);
    retryTimerRef.current = setTimeout(() => {
      if (navigator.onLine) syncNowFn();
    }, delay);
  }, []);

  const syncNow = useCallback(async () => {
    if (syncingRef.current || status !== 'authenticated' || !userId) return;
    syncingRef.current = true;
    useOfflineStore.getState().setSyncing(true);

    try {
      // Only this user's entries — another account's queue on a shared device is
      // left untouched for that account's next session.
      const items = await listOutboxFor(userId);
      const unresolved = items.filter((item) => !item.conflict);
      if (unresolved.length === 0) {
        await refreshOutboxCounts(userId);
        return;
      }

      let succeeded = 0;
      let permanentFailures = 0;
      let newConflicts = 0;
      let hitTransientFailure = false;

      for (const item of unresolved) {
        const result = await syncOne(item);
        if (result === 'ok') {
          await removeOutboxItem(item.id);
          succeeded++;
        } else if (result === 'permanent') {
          // A validation error will never succeed by retrying — remove it rather
          // than blocking every item queued after it, and tell the user plainly
          // that this one specific entry needs their attention.
          await removeOutboxItem(item.id);
          permanentFailures++;
        } else if (result === 'conflict') {
          const serverVersion = await fetchServerVersion(item);
          await updateOutboxItem(item.id, { conflict: { serverVersion, detectedAt: new Date().toISOString() } });
          newConflicts++;
          // Not a transient failure — keep processing the rest of the queue.
        } else {
          // Transient (offline again, server briefly down) — leave it queued and
          // stop for now; back-off schedules the next attempt.
          await updateOutboxItem(item.id, { attempts: item.attempts + 1, lastError: result.message });
          hitTransientFailure = true;
          break;
        }
      }

      await refreshOutboxCounts(userId);

      if (succeeded > 0) {
        queryClient.clear();
        toast.success(
          tNowPlural('sync.synced', succeeded),
          tNow('sync.syncedBody'),
        );
      }
      if (permanentFailures > 0) {
        toast.error(
          tNowPlural('sync.failed', permanentFailures),
          tNow('sync.failedBody'),
        );
      }
      if (newConflicts > 0) {
        toast.error(
          tNowPlural('sync.conflict', newConflicts),
          tNow('sync.conflictBody'),
        );
      }

      if (hitTransientFailure) {
        failureStreakRef.current += 1;
        scheduleRetry(() => void syncNow());
      } else {
        failureStreakRef.current = 0;
        if (succeeded > 0) {
          useOfflineStore.getState().setJustSynced(true);
          if (justSyncedTimerRef.current) clearTimeout(justSyncedTimerRef.current);
          justSyncedTimerRef.current = setTimeout(() => useOfflineStore.getState().setJustSynced(false), 4_000);
        }
      }
    } finally {
      syncingRef.current = false;
      useOfflineStore.getState().setSyncing(false);
    }
  }, [status, userId, queryClient, toast, scheduleRetry]);

  // Count what's already queued as soon as we know who's signed in.
  useEffect(() => {
    if (status === 'authenticated') void refreshOutboxCounts(userId);
  }, [status, userId]);

  // The moment the browser reports a connection again, try to drain the queue.
  useEffect(() => {
    if (online) void syncNow();
  }, [online, syncNow]);

  useEffect(
    () => () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (justSyncedTimerRef.current) clearTimeout(justSyncedTimerRef.current);
    },
    [],
  );

  return { syncNow };
}

type SyncResult = 'ok' | 'permanent' | 'conflict' | Error;

async function fetchServerVersion(item: OutboxItem): Promise<unknown> {
  try {
    return await api.get<unknown>(item.path, { headers: item.workspaceId ? { 'X-Workspace-Id': item.workspaceId } : undefined });
  } catch {
    // The record may have been deleted by whoever changed it — the dialog shows "no longer exists" rather than failing to open.
    return null;
  }
}

function requestFor(method: OutboxItem['method'], path: string, body: Record<string, unknown>, headers?: Record<string, string>): Promise<unknown> {
  switch (method) {
    case 'POST':
      return api.post(path, body, { headers });
    case 'PATCH':
      return api.patch(path, body, { headers });
    case 'PUT':
      return api.put(path, body, { headers });
    case 'DELETE':
      return api.delete(path, body, { headers });
  }
}

export async function syncOne(item: OutboxItem): Promise<SyncResult> {
  try {
    // Replay into the workspace the entry was recorded in, not the active one —
    // otherwise switching workspace before a sync sent it to the wrong ledger,
    // where it was rejected and discarded.
    const headers: Record<string, string> = {};
    if (item.workspaceId) headers['X-Workspace-Id'] = item.workspaceId;
    if (item.idempotencyKey) headers['Idempotency-Key'] = item.idempotencyKey;
    await requestFor(item.method, item.path, item.body, Object.keys(headers).length > 0 ? headers : undefined);
    return 'ok';
  } catch (err) {
    if (err instanceof ApiRequestError) {
      if (err.code === 'STALE_REVISION') return 'conflict';
      // The server is still applying an earlier attempt of this very entry. Not a rejection:
      // keep it queued and ask again later, which then returns the stored result.
      if (err.code === 'IDEMPOTENCY_IN_PROGRESS') return new Error(err.message);
      // A 4xx means the request itself is invalid and will never succeed
      // unchanged — don't retry it forever. Except: 401/403 say the *session*
      // isn't valid right now (it expired while offline), and 408/429 are
      // timing. None of those is a problem with the entry, so it stays queued
      // for the next signed-in sync instead of being thrown away.
      if (err.status >= 400 && err.status < 500 && ![401, 403, 408, 429].includes(err.status)) {
        return 'permanent';
      }
      return new Error(err.message);
    }
    return err instanceof Error ? err : new Error('Sync failed.');
  }
}

export interface ResolveConflictResult {
  ok: boolean;
  message: string;
  detail?: string;
}

/**
 * The user's explicit call on a conflicted item — never automatic. `discard`
 * drops the queued edit and keeps the server's version; `overwrite` re-reads
 * the server's current revision and resubmits the same edit on top of it, so
 * the user's change still lands, just no longer blind to what it's replacing.
 *
 * A standalone function (not part of the `useOfflineSync` hook) so
 * `ConflictDialog` can call it without instantiating a second copy of the
 * hook's online-listener and retry-timer side effects.
 */
export async function resolveOutboxConflict(
  item: OutboxItem,
  action: 'discard' | 'overwrite',
  userId: string | null,
  queryClient: QueryClient,
): Promise<ResolveConflictResult> {
  if (action === 'discard') {
    await removeOutboxItem(item.id);
    await refreshOutboxCounts(userId);
    return { ok: true, message: tNow('sync.discarded'), detail: tNow('sync.otherVersionKept') };
  }

  try {
    const current = await fetchServerVersion(item);
    const latestRev = (current as { rev?: number } | null)?.rev;
    await requestFor(item.method, item.path, { ...item.body, rev: latestRev ?? item.body.rev }, item.workspaceId ? { 'X-Workspace-Id': item.workspaceId } : undefined);
    await removeOutboxItem(item.id);
    await refreshOutboxCounts(userId);
    queryClient.clear();
    return { ok: true, message: tNow('sync.applied') };
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === 'STALE_REVISION') {
      // Changed again in the moment between the re-read and the resubmit — rare, but leave it conflicted rather than silently failing.
      const serverVersion = await fetchServerVersion(item);
      await updateOutboxItem(item.id, { conflict: { serverVersion, detectedAt: new Date().toISOString() } });
      await refreshOutboxCounts(userId);
      return { ok: false, message: tNow('sync.changedAgain'), detail: tNow('sync.reviewLatestTryAgain') };
    }
    return { ok: false, message: tNow('sync.couldNotApply'), detail: err instanceof Error ? err.message : tNow('sync.pleaseTryAgain') };
  }
}
