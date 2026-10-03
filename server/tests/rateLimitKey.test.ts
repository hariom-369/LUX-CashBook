import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { rateLimitKey } from '../src/middleware/rateLimit.js';
import { signAccessToken } from '../src/lib/tokens.js';

const reqWith = (authorization: string | undefined, ip = '203.0.113.7', user?: { _id: string }) =>
  ({ ip, user, get: (h: string) => (h.toLowerCase() === 'authorization' ? authorization : undefined) }) as unknown as Request;

describe('rate-limit key (shared NAT / carrier-grade NAT)', () => {
  it('gives each signed-in user their own bucket even when they share an IP', () => {
    const a = signAccessToken({ sub: 'user-a', sid: 's1', email: 'a@x.test', tv: 0 });
    const b = signAccessToken({ sub: 'user-b', sid: 's2', email: 'b@x.test', tv: 0 });
    const keyA = rateLimitKey(reqWith(`Bearer ${a}`));
    const keyB = rateLimitKey(reqWith(`Bearer ${b}`));
    expect(keyA).toBe('u:user-a');
    expect(keyB).toBe('u:user-b');
    expect(keyA).not.toBe(keyB);
  });

  it('keys an anonymous caller by address', () => {
    expect(rateLimitKey(reqWith(undefined, '198.51.100.1'))).toBe('ip:198.51.100.1');
  });

  it('does not let a forged or expired token claim a user bucket', () => {
    const forged = jwt.sign({ sub: 'victim', sid: 's', email: 'v@x.test', tv: 0 }, 'a-different-secret-that-is-long-enough!!', {
      issuer: 'khata',
      audience: 'khata-app',
    });
    expect(rateLimitKey(reqWith(`Bearer ${forged}`, '198.51.100.2'))).toBe('ip:198.51.100.2');
    expect(rateLimitKey(reqWith('Bearer not-a-token', '198.51.100.3'))).toBe('ip:198.51.100.3');
    const expired = jwt.sign({ sub: 'victim', sid: 's', email: 'v@x.test', tv: 0 }, process.env.JWT_ACCESS_SECRET!, {
      issuer: 'khata',
      audience: 'khata-app',
      expiresIn: -10,
    });
    expect(rateLimitKey(reqWith(`Bearer ${expired}`, '198.51.100.4'))).toBe('ip:198.51.100.4');
  });

  it('prefers an already-authenticated request user', () => {
    expect(rateLimitKey(reqWith(undefined, '198.51.100.5', { _id: 'abc' }))).toBe('u:abc');
  });
});
