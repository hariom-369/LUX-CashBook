import { getAccessToken } from './api';
import { useAuthStore } from '../stores/auth.store';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

/**
 * Download a file from an authenticated endpoint.
 *
 * A plain `<a href>` can't carry the `Authorization` header, so the request goes
 * through `fetch` and the response becomes an object URL — the browser's own
 * download flow, not a data: URI hack, so a large PDF or backup file never passes
 * through JS string encoding.
 */
export async function downloadFile(path: string, query?: Record<string, string>): Promise<void> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value) url.searchParams.set(key, value);
    }
  }

  const workspaceId = useAuthStore.getState().activeWorkspaceId;
  const token = getAccessToken();

  const response = await fetch(url.toString(), {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
    },
    credentials: 'include',
  });

  if (!response.ok) {
    let message = 'The download failed. Please try again.';
    try {
      const body = await response.json();
      message = body?.error?.message ?? message;
    } catch {
      /* Non-JSON error body — keep the default message. */
    }
    throw new Error(message);
  }

  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const fileName = match?.[1] ?? path.split('/').pop() ?? 'download';

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Give the browser a moment to start the save before the object URL is freed.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
}
