import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `config/env.ts` computes everything once at import time and calls
 * `process.exit(1)` on invalid configuration — appropriate for a real boot, but
 * it means testing it requires a fresh module instance per scenario (so a
 * previous test's env values can't leak in) and a mocked `process.exit` (so a
 * "this config should be refused" test doesn't actually kill the test worker).
 */
const ORIGINAL_ENV = { ...process.env };

async function freshEnv() {
  vi.resetModules();
  return import('../src/config/env.js');
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = 'production';
  process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
  process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/khata_env_test';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('cross-site cookie configuration', () => {
  it('defaults to SameSite=Strict when COOKIE_CROSS_SITE is unset, unchanged from before this phase', async () => {
    const { env } = await freshEnv();
    expect(env.cookieSameSite).toBe('strict');
  });

  it('switches to SameSite=None and forces Secure when COOKIE_CROSS_SITE=true', async () => {
    process.env.COOKIE_CROSS_SITE = 'true';
    const { env } = await freshEnv();
    expect(env.cookieSameSite).toBe('none');
    expect(env.cookieSecure).toBe(true);
  });

  it('forces Secure=true even if COOKIE_SECURE=auto would otherwise differ', async () => {
    process.env.COOKIE_CROSS_SITE = 'true';
    process.env.COOKIE_SECURE = 'auto';
    const { env } = await freshEnv();
    expect(env.cookieSecure).toBe(true);
  });

  it('refuses to boot when COOKIE_CROSS_SITE=true is combined with COOKIE_SECURE=false', async () => {
    process.env.COOKIE_CROSS_SITE = 'true';
    process.env.COOKIE_SECURE = 'false';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((() => {
      throw new Error('process.exit called');
    }) as unknown) as (code?: string | number | null) => never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(freshEnv()).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
  });

  it('still refuses to boot in production without MONGODB_URI (unchanged behaviour)', async () => {
    delete process.env.MONGODB_URI;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((() => {
      throw new Error('process.exit called');
    }) as unknown) as (code?: string | number | null) => never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(freshEnv()).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
  });
});
