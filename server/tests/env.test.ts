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
  // The rest of a valid production configuration (config/productionChecks.ts), so each test below only varies what it is about.
  Object.assign(process.env, {
    STORAGE_DRIVER: 's3',
    S3_BUCKET: 'khata-test',
    S3_REGION: 'ap-south-1',
    SMTP_HOST: 'smtp.example.com',
    MAIL_FROM: 'Khata <no-reply@example.com>',
    APP_URL: 'https://app.example.com',
    API_URL: 'https://api.example.com',
  });
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
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

/**
 * Regression: these were parsed with `z.coerce.boolean()`, which turns any
 * non-empty string into `true` — so `COOKIE_CROSS_SITE=false`, exactly as
 * `.env.example` ships it, silently enabled `SameSite=None` cookies.
 */
describe('boolean environment variables', () => {
  it('reads COOKIE_CROSS_SITE=false as false', async () => {
    process.env.COOKIE_CROSS_SITE = 'false';
    const { env } = await freshEnv();
    expect(env.cookieSameSite).toBe('strict');
  });

  it('reads ENABLE_SCHEDULER=false and SMTP_SECURE=false as false', async () => {
    process.env.ENABLE_SCHEDULER = 'false';
    process.env.SMTP_SECURE = 'false';
    const { env } = await freshEnv();
    expect(env.ENABLE_SCHEDULER).toBe(false);
    expect(env.SMTP_SECURE).toBe(false);
  });

  it('accepts true/false, 1/0, yes/no and on/off in any case', async () => {
    for (const [value, expected] of [
      ['TRUE', true], ['1', true], ['yes', true], ['On', true],
      ['False', false], ['0', false], ['no', false], ['OFF', false],
    ] as const) {
      process.env.ENABLE_SCHEDULER = value;
      const { env } = await freshEnv();
      expect(env.ENABLE_SCHEDULER, value).toBe(expected);
    }
  });

  it('keeps the documented defaults when a variable is unset', async () => {
    delete process.env.COOKIE_CROSS_SITE;
    delete process.env.ENABLE_SCHEDULER;
    delete process.env.SMTP_SECURE;
    const { env } = await freshEnv();
    expect(env.cookieSameSite).toBe('strict');
    expect(env.ENABLE_SCHEDULER).toBe(true);
    expect(env.SMTP_SECURE).toBe(false);
  });

  it('refuses to boot on a value that is not a boolean word', async () => {
    process.env.ENABLE_SCHEDULER = 'maybe';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((() => {
      throw new Error('process.exit called');
    }) as unknown) as (code?: string | number | null) => never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(freshEnv()).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
  });
});

describe('feature flags', () => {
  it('turns a flag on only for an explicit true value', async () => {
    process.env.FEATURE_AI_ASSISTANT = 'true';
    process.env.FEATURE_INVOICING = 'false';
    const { env } = await freshEnv();
    expect(env.features.aiAssistant).toBe(true);
    expect(env.features.invoicing).toBe(false);
    expect(env.features.inventory).toBe(false);
  });

  it('refuses to boot on a flag value that is not a boolean word', async () => {
    process.env.FEATURE_INVENTORY = 'enabled';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((() => {
      throw new Error('process.exit called');
    }) as unknown) as (code?: string | number | null) => never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(freshEnv()).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
  });
});

describe('production boot checks (docs/DEPLOYMENT.md)', () => {
  async function refused(): Promise<string> {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await freshEnv();
    const message = error.mock.calls.map((c) => String(c[0])).join('\n');
    expect(exit).toHaveBeenCalledWith(1);
    return message;
  }

  it('boots with a complete production configuration', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { env } = await freshEnv();
    expect(exit).not.toHaveBeenCalled();
    expect(env.STORAGE_DRIVER).toBe('s3');
  });

  it('refuses local storage, naming the way out', async () => {
    process.env.STORAGE_DRIVER = 'local';
    expect(await refused()).toMatch(/STORAGE_DRIVER=local[\s\S]*ALLOW_LOCAL_STORAGE_IN_PRODUCTION/);
  });

  it('accepts local storage only when a persistent disk is declared', async () => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION = 'true';
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await freshEnv();
    expect(exit).not.toHaveBeenCalled();
  });

  it('refuses a missing SMTP host and the placeholder sender', async () => {
    delete process.env.SMTP_HOST;
    delete process.env.MAIL_FROM;
    const message = await refused();
    expect(message).toMatch(/SMTP_HOST/);
    expect(message).toMatch(/MAIL_FROM/);
  });

  it('refuses localhost URLs', async () => {
    process.env.APP_URL = 'http://localhost:5173';
    expect(await refused()).toMatch(/APP_URL still points at localhost/);
  });

  it('warns, but boots, when cross-site cookies are chosen', async () => {
    process.env.COOKIE_CROSS_SITE = 'true';
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await freshEnv();
    expect(exit).not.toHaveBeenCalled();
    expect(warn.mock.calls.join(' ')).toMatch(/third-party cookies/);
  });
});
