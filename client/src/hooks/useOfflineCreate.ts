import { useCallback } from 'react';
import { useToast } from '../components/ui/Toast';
import { submitOrQueue } from '../lib/offlineMutation';
import { useAuthStore } from '../stores/auth.store';
import { tNow } from '../i18n';

/**
 * `const createOrQueue = useOfflineCreate()` — a drop-in for `api.post(path, body)` on
 * pure creates (§Phase 15 follow-up). Online it behaves like `api.post` and resolves
 * `true`. Offline it queues the create — under an `Idempotency-Key` the server uses to
 * apply it exactly once, even if an earlier attempt reached the server and only the
 * reply was lost — tells the user, and resolves `false`, so the caller skips its own
 * "created" message and closes the form. Real rejections still throw.
 *
 * Only creates whose result nothing else needs straight away belong here: an entry that
 * must be *referenced* by id before sync (a person you then lend to) cannot be queued
 * usefully, and actions that depend on current server state (settling a balance,
 * contributing to a goal, stock movements) are deliberately left online-only.
 */
export function useOfflineCreate() {
  const toast = useToast();
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  return useCallback(
    async (path: string, body: Record<string, unknown>): Promise<boolean> => {
      const result = await submitOrQueue({ method: 'POST', path, body, workspaceId, userId });
      if (result.queued) {
        toast.success(tNow('sync.createSavedOffline'), tNow('sync.createWillAppear'));
        return false;
      }
      return true;
    },
    [toast, workspaceId, userId],
  );
}
