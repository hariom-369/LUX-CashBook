import { beforeEach, describe, expect, it, vi } from 'vitest';

// Cross-site deployment (frontend on one site, API on another): SameSite=None; Secure, and Partitioned (CHIPS).
vi.mock('../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/env.js')>();
  return { env: { ...actual.env, cookieSameSite: 'none' as const, cookieSecure: true, cookiePartitioned: true } };
});

import { anon, as, createTestUser, type TestUser } from './helpers.js';

/**
 * Browsers set to block third-party cookies (Chrome/Edge "block third-party cookies", incognito, strict tracking
 * prevention) refuse a plain `SameSite=None` cookie, so a Vercel + Render deployment signed everyone out on every
 * reload. `Partitioned` keeps the cookie - stored per top-level site - in those browsers.
 */

let user: TestUser;

beforeEach(async () => {
  user = await createTestUser();
});

const refreshCookie = (headers: Record<string, unknown>) => (headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('khata_rt='))!;

describe('the refresh cookie in cross-site mode', () => {
  it('is HttpOnly, Secure, SameSite=None and Partitioned, scoped to the auth routes', async () => {
    const res = await anon().post('/api/v1/auth/login').send({ email: user.email, password: user.password }).expect(200);
    const cookie = refreshCookie(res.headers);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Partitioned');
    expect(cookie).toContain('Path=/api/v1/auth');
  });

  it('is renewed with the same attributes on refresh (a rotated cookie must not lose its partition)', async () => {
    const res = await anon().post('/api/v1/auth/refresh').set('Cookie', user.refreshCookie).expect(200);
    expect(refreshCookie(res.headers)).toMatch(/SameSite=None.*Partitioned|Partitioned.*SameSite=None/);
  });

  it('is cleared with the same attributes, so a partitioned cookie is really removed (sign out everywhere)', async () => {
    const res = await as(user).post('/api/v1/auth/logout-all').set('Cookie', user.refreshCookie);
    const cleared = (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) => c.startsWith('khata_rt='));
    expect(cleared).toBeDefined();
    expect(cleared).toContain('khata_rt=;');
    expect(cleared).toContain('Partitioned');
    expect(cleared).toContain('SameSite=None');
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('is cleared the same way when the account is deleted', async () => {
    const res = await as(user).post('/api/v1/users/me/delete').send({ password: user.password, confirmation: 'DELETE' });
    expect(res.status).toBe(200);
    const cleared = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('khata_rt='))!;
    expect(cleared).toContain('Partitioned');
    expect(cleared).toContain('Secure');
    expect(cleared).toContain('SameSite=None');
  });
});
