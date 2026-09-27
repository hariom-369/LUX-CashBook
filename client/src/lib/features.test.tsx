import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

import { api } from './api';
import { useFeature, useFeatureFlags } from './features';

const get = vi.mocked(api.get);

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  get.mockReset();
});

describe('feature flags', () => {
  it('treats every flag as off until the server answers', () => {
    get.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useFeatureFlags(), { wrapper: wrapper() });
    expect(Object.values(result.current).every((on) => on === false)).toBe(true);
  });

  it('switches on exactly what the server enables', async () => {
    get.mockResolvedValue({ aiAssistant: true });
    const { result } = renderHook(() => ({ ai: useFeature('aiAssistant'), invoicing: useFeature('invoicing') }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.ai).toBe(true));
    expect(result.current.invoicing).toBe(false);
  });

  it('stays all-off when the server is unreachable', async () => {
    get.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useFeature('inventory'), { wrapper: wrapper() });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("doesn't force-skip the auth header — a signed-in user's workspace overrides must reach the server", async () => {
    // Regression: this call used to pass `{ skipAuth: true }` unconditionally,
    // which stripped the access token for signed-in users too and meant a
    // workspace's feature-flag overrides (server/src/routes.ts#/features) could
    // never take effect. The route itself doesn't require auth (`optionalAuth`),
    // so there's no reason to withhold the token when one exists.
    get.mockResolvedValue({});
    renderHook(() => useFeatureFlags(), { wrapper: wrapper() });
    await waitFor(() => expect(get).toHaveBeenCalled());
    const [path, options] = get.mock.calls[0]!;
    expect(path).toBe('/features');
    expect((options as { skipAuth?: boolean } | undefined)?.skipAuth).not.toBe(true);
  });
});
