import { useCallback } from 'react';
import { useToast } from '../components/ui/Toast';
import { submitOrQueue } from '../lib/offlineMutation';
import { useAuthStore } from '../stores/auth.store';
import { tNow } from '../i18n';

/**
 * `const patchOrQueue = useOfflinePatch()` — a drop-in for `api.patch(path, body)`
 * on edits that carry a `rev` (§Phase 15). Online it behaves exactly like
 * `api.patch`; offline it queues the edit, tells the user, and resolves, so the
 * form closes the same way a saved edit does. Real rejections still throw.
 */
export function useOfflinePatch() {
  const toast = useToast();
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  return useCallback(
    async (path: string, body: Record<string, unknown>): Promise<void> => {
      const rev = typeof body.rev === 'number' ? body.rev : undefined;
      const result = await submitOrQueue({ method: 'PATCH', path, body, workspaceId, userId, rev });
      if (result.queued && result.conflict) {
        toast.error(tNow('sync.someoneElseChangedFirst'), tNow('sync.editKeptReview'));
      } else if (result.queued) toast.success(tNow('sync.editSavedOffline'), tNow('sync.willSyncWhenOnline'));
    },
    [toast, workspaceId, userId],
  );
}
