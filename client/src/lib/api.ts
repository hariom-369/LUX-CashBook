import type { ApiError, ApiResponse } from '@khata/shared';

/**
 * The HTTP client.
 *
 * Two decisions drive everything here:
 *
 *  1. The access token lives in a module-scoped variable, never in `localStorage`.
 *     A token in web storage is readable by any script that gets injected into the
 *     page; a token in a closure dies with the tab and cannot be exfiltrated by
 *     XSS. The refresh token lives in an httpOnly cookie the JS never sees at all.
 *
 *  2. Refreshing is *single-flight*. When a burst of requests all hit an expired
 *     token at once, they queue behind one refresh call rather than racing — which
 *     matters because refresh tokens rotate, and concurrent refreshes would look
 *     like token reuse and revoke the whole session.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

let accessToken: string | null = null;
let activeWorkspaceId: string | null = null;
let refreshPromise: Promise<string | null> | null = null;
let onSessionLost: ((err: unknown) => void) | null = null;
let onSessionRestored: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setActiveWorkspaceId(id: string | null): void {
  activeWorkspaceId = id;
}

/** Called when refreshing fails — the app store uses it to sign the user out. */
export function setSessionLostHandler(handler: ((err: unknown) => void) | null): void {
  onSessionLost = handler;
}

/** Called whenever a mid-session refresh succeeds — clears any "offline session" flag. */
export function setSessionRestoredHandler(handler: (() => void) | null): void {
  onSessionRestored = handler;
}

/**
 * An error the UI can act on.
 *
 * `code` is the stable identifier the server promises; `fields` maps straight onto
 * React Hook Form's `setError`, so server-side validation lands on the right input
 * without any per-form plumbing.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Array<{ path: string; message: string }>;
  readonly requestId?: string;

  constructor(status: number, error: ApiError['error']) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = error.code;
    this.fields = error.fields ?? [];
    this.requestId = error.requestId;
  }

  /** True when retrying the exact same request could plausibly succeed. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.status === 429 || this.code === 'NETWORK_ERROR';
  }

  get isOffline(): boolean {
    return this.code === 'NETWORK_ERROR';
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skip the Authorization header — used by the auth endpoints themselves. */
  skipAuth?: boolean;
  /** Skip the automatic refresh-and-retry, to avoid recursion on /auth/refresh. */
  skipRefresh?: boolean;
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
  /** Makes a retried POST safe to send twice (§51). */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export interface Envelope<T> {
  data: T;
  /** Extra figures the endpoint returns alongside the payload (filtered totals, counts). */
  meta?: Record<string, unknown>;
}

async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<Envelope<T>> {
  const { body, skipAuth, query, idempotencyKey, headers, ...rest } = options;

  const finalHeaders = new Headers(headers);
  if (body !== undefined && !(body instanceof FormData)) {
    finalHeaders.set('Content-Type', 'application/json');
  }
  if (!skipAuth && accessToken) {
    finalHeaders.set('Authorization', `Bearer ${accessToken}`);
  }
  if (activeWorkspaceId) {
    finalHeaders.set('X-Workspace-Id', activeWorkspaceId);
  }
  if (idempotencyKey) {
    finalHeaders.set('Idempotency-Key', idempotencyKey);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      ...rest,
      headers: finalHeaders,
      // Required for the httpOnly refresh cookie to be sent and set.
      credentials: 'include',
      body:
        body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    // fetch only rejects for network-level failures — the offline case (§39).
    throw new ApiRequestError(0, {
      code: 'NETWORK_ERROR',
      message: "You're offline. Your changes are saved on this device and will sync when you reconnect.",
    });
  }

  if (response.status === 204) {
    return { data: undefined as T };
  }

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiRequestError(response.status, {
      code: 'BAD_RESPONSE',
      message: 'The server sent a response we could not read. Please try again.',
    });
  }

  if (!response.ok || payload.ok === false) {
    const error = 'error' in payload ? payload.error : { code: 'UNKNOWN', message: 'Something went wrong.' };
    throw new ApiRequestError(response.status, error);
  }

  return { data: payload.data, meta: payload.meta };
}

/**
 * Refresh the access token, collapsing concurrent callers into one request.
 */
async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const { data } = await rawRequest<{ accessToken: string }>('/auth/refresh', {
        method: 'POST',
        skipAuth: true,
        skipRefresh: true,
      });
      accessToken = data.accessToken;
      onSessionRestored?.();
      return data.accessToken;
    } catch (err) {
      accessToken = null;
      onSessionLost?.(err);
      return null;
    } finally {
      // Cleared in a microtask so callers already awaiting this promise resolve
      // against it rather than kicking off a second refresh.
      queueMicrotask(() => {
        refreshPromise = null;
      });
    }
  })();

  return refreshPromise;
}

/** Full response including `meta`. Use when an endpoint returns figures alongside its payload. */
export async function requestEnvelope<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Envelope<T>> {
  try {
    return await rawRequest<T>(path, options);
  } catch (err) {
    const expired =
      err instanceof ApiRequestError &&
      err.status === 401 &&
      (err.code === 'TOKEN_EXPIRED' || err.code === 'NO_TOKEN');

    if (!expired || options.skipRefresh || options.skipAuth) {
      throw err;
    }

    const token = await refreshAccessToken();
    if (!token) throw err;

    return rawRequest<T>(path, { ...options, skipRefresh: true });
  }
}

/** The common case: just the payload. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const envelope = await requestEnvelope<T>(path, options);
  return envelope.data;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  getWithMeta: <T>(path: string, options?: RequestOptions) =>
    requestEnvelope<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE', body }),
};

/** Turn any thrown value into a sentence worth showing a user (§57). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong. Please try again.';
}
