import { api, ApiRequestError } from './api';
import { enqueueOutboxItem, outboxCount, outboxCountFor, updateOutboxItem, type OutboxItem } from './offlineDb';
import { useOfflineStore } from '../stores/offline.store';
import { refreshOutboxCounts } from '../hooks/useOfflineSync';

/**
 * The generic "save this, or queue it if we're offline" path (§Phase 15).
 *
 * `QuickAddSheet.tsx` hand-rolled this once, for transaction creates only;
 * this is that same logic pulled out so any call site can adopt it for any
 * method, not just POST. Adoption is still per-call-site, not automatic for
 * every mutation in the app — see `docs/ROADMAP_PHASE15_NOTES.md` for which
 * screens have been migrated and which still fail outright when offline
 * rather than queueing.
 */
export interface SubmitOrQueueInput {
  method: OutboxItem['method'];
  path: string;
  body: Record<string, unknown>;
  workspaceId: string | null | undefined;
  userId: string | null | undefined;
  /** Override the generated `Idempotency-Key` for a POST (tests). */
  idempotencyKey?: string;
  /** The `rev` this edit was read at — carried through so a replay can tell a real conflict apart from any other rejection. Omit for a create, which never conflicts. */
  rev?: number;
}

export type SubmitOrQueueResult<T> = { queued: false; data: T } | { queued: true; conflict?: boolean };

export async function submitOrQueue<T>(input: SubmitOrQueueInput): Promise<SubmitOrQueueResult<T>> {
  // A create is only safe to retry — now or from the queue later — if the server can
  // recognise the retry. One key per submission, fixed before the first attempt.
  const idempotencyKey = input.method === 'POST' ? (input.idempotencyKey ?? crypto.randomUUID()) : undefined;
  const headers: Record<string, string> = {};
  if (input.workspaceId) headers['X-Workspace-Id'] = input.workspaceId;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  try {
    const data = await requestFor<T>(input.method, input.path, input.body, headers);
    return { queued: false, data };
  } catch (err) {
    // A stale revision while *online* takes the same path as one found on replay:
    // the edit is kept (never lost, never silently overwriting), the server's
    // current version is attached, and the conflict dialog lets the user decide.
    if (err instanceof ApiRequestError && err.code === 'STALE_REVISION' && input.method === 'PATCH') {
      const serverVersion = await api.get<unknown>(input.path, { headers }).catch(() => null);
      const item = await enqueueOutboxItem({
        method: input.method,
        path: input.path,
        body: input.body,
        workspaceId: input.workspaceId ?? '',
        userId: input.userId ?? undefined,
        rev: input.rev,
        idempotencyKey,
      });
      await updateOutboxItem(item.id, { conflict: { serverVersion, detectedAt: new Date().toISOString() } });
      await refreshOutboxCounts(input.userId ?? null);
      return { queued: true, conflict: true };
    }
    if (!(err instanceof ApiRequestError) || !err.isOffline) throw err;

    await enqueueOutboxItem({
      method: input.method,
      path: input.path,
      body: input.body,
      workspaceId: input.workspaceId ?? '',
      userId: input.userId ?? undefined,
      rev: input.rev,
      idempotencyKey,
    });
    useOfflineStore.getState().setPendingCount(
      input.userId ? await outboxCountFor(input.userId) : await outboxCount(),
    );
    return { queued: true };
  }
}

function requestFor<T>(method: OutboxItem['method'], path: string, body: Record<string, unknown>, headers?: Record<string, string>): Promise<T> {
  switch (method) {
    case 'POST':
      return api.post<T>(path, body, { headers });
    case 'PATCH':
      return api.patch<T>(path, body, { headers });
    case 'PUT':
      return api.put<T>(path, body, { headers });
    case 'DELETE':
      return api.delete<T>(path, body, { headers });
  }
}
