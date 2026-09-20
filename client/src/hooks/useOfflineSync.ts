import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiRequestError, api } from '../lib/api';
import { listOutbox, outboxCount, removeOutboxItem, updateOutboxItem, type OutboxItem } from '../lib/offlineDb';
import { useOfflineStore } from '../stores/offline.store';
import { useOnlineStatus } from './useOnlineStatus';
import { useToast } from '../components/ui/Toast';
import { useAuthStore } from '../stores/auth.store';

/**
 * Flush the offline outbox when a connection is available (§39).
 *
 * Runs the queue strictly in the order items were created — a transaction queued
 * first should post first, both because that is what the user would expect from
 * their own timeline and because a later item may reference state (an account
 * balance, say) that only makes sense once an earlier one has landed. Each item's
 * `idempotencyKey` (already inside its `body`, generated when it was queued) is
 * what makes a sync that gets interrupted and retried safe to just run again from
 * the top: the server recognises a repeat and returns the original transaction
 * rather than creating a second one.
 */
export function useOfflineSync(): { syncNow: () => Promise<void> } {
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const toast = useToast();
  const status = useAuthStore((s) => s.status);
  const syncingRef = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    useOfflineStore.getState().setPendingCount(await outboxCount());
  }, []);

  const syncNow = useCallback(async () => {
    if (syncingRef.current || status !== 'authenticated') return;
    syncingRef.current = true;
    useOfflineStore.getState().setSyncing(true);

    try {
      const items = await listOutbox();
      if (items.length === 0) return;

      let succeeded = 0;
      let permanentFailures = 0;

      for (const item of items) {
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
        } else {
          // Transient (offline again, server briefly down) — leave it queued and
          // stop for now; the next connectivity change or interval tries again.
          await updateOutboxItem(item.id, { attempts: item.attempts + 1, lastError: result.message });
          break;
        }
      }

      await refreshPendingCount();

      if (succeeded > 0) {
        queryClient.clear();
        toast.success(
          `Synced ${succeeded} offline ${succeeded === 1 ? 'entry' : 'entries'}`,
          'Everything you recorded while offline is now saved.',
        );
      }
      if (permanentFailures > 0) {
        toast.error(
          `${permanentFailures} offline ${permanentFailures === 1 ? 'entry' : 'entries'} could not be saved`,
          'Something about the entry was rejected — please re-enter it.',
        );
      }
    } finally {
      syncingRef.current = false;
      useOfflineStore.getState().setSyncing(false);
    }
  }, [status, queryClient, toast, refreshPendingCount]);

  // Count what's already queued as soon as we know who's signed in.
  useEffect(() => {
    if (status === 'authenticated') void refreshPendingCount();
  }, [status, refreshPendingCount]);

  // The moment the browser reports a connection again, try to drain the queue.
  useEffect(() => {
    if (online) void syncNow();
  }, [online, syncNow]);

  // Belt and braces: a periodic retry in case `online` fired before the network
  // was actually reachable (captive portal, flaky Wi-Fi).
  useEffect(() => {
    const interval = setInterval(() => {
      if (navigator.onLine) void syncNow();
    }, 30_000);
    return () => clearInterval(interval);
  }, [syncNow]);

  return { syncNow };
}

type SyncResult = 'ok' | 'permanent' | Error;

async function syncOne(item: OutboxItem): Promise<SyncResult> {
  try {
    await api.post(item.path, item.body);
    return 'ok';
  } catch (err) {
    if (err instanceof ApiRequestError) {
      // A 4xx other than a rate limit means the request itself is invalid and
      // will never succeed unchanged — don't retry it forever.
      if (err.status >= 400 && err.status < 500 && err.status !== 429) {
        return 'permanent';
      }
      return new Error(err.message);
    }
    return err instanceof Error ? err : new Error('Sync failed.');
  }
}
