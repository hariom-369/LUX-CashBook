import { useEffect, useState } from 'react';
import { getAccessToken } from '../lib/api';
import { useAuthStore } from '../stores/auth.store';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

/**
 * Fetch an authenticated endpoint and expose it as an object URL.
 *
 * `<img src>` and a plain `<a href>` cannot carry an `Authorization` header, and
 * attachment downloads are deliberately behind auth (§69) rather than served from
 * a guessable public URL. This is the client-side half of that trade: fetch the
 * bytes through the normal authenticated request path, then hand the browser a
 * local blob URL to render — the token itself never touches the DOM or a network
 * log line.
 */
export function useAuthedBlobUrl(path: string | null): { url: string | null; loading: boolean; error: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState(false);
  const workspaceId = useAuthStore((s) => s.activeWorkspaceId);

  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(false);

    fetch(`${API_BASE}${path}`, {
      headers: {
        ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
        ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
      },
      credentials: 'include',
    })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load');
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, workspaceId]);

  return { url, loading, error };
}
