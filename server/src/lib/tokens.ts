import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized } from './errors.js';

export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  /** Active workspace at the time the token was issued. */
  ws?: string;
  /** Session/token-family id, so a session can be revoked wholesale. */
  sid: string;
  email: string;
  /** Token version — bumped on password change to invalidate every live token. */
  tv: number;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: 'khata',
    audience: 'khata-app',
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'khata',
      audience: 'khata-app',
    }) as AccessTokenClaims;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      // The client uses this specific code to decide to hit /auth/refresh rather
      // than bouncing the user to the login screen.
      throw unauthorized('Your session expired. Refreshing…', 'TOKEN_EXPIRED');
    }
    throw unauthorized('Your session is no longer valid. Please sign in again.', 'TOKEN_INVALID');
  }
}

/** Seconds until an access token expires, for the client's refresh timer. */
export function accessTokenTtlSeconds(): number {
  const ttl = env.ACCESS_TOKEN_TTL;
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 900;
  const value = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  return value * { s: 1, m: 60, h: 3600, d: 86400 }[unit];
}

/**
 * Refresh tokens are opaque random strings rather than JWTs: they must be
 * revocable, and a self-contained token cannot be revoked. Only the SHA-256
 * digest is stored, so a database dump does not hand out live sessions.
 */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(48).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Single-use, time-limited tokens for email verification and password reset. */
export function generateActionToken(): { token: string; hash: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString('base64url');
  return {
    token,
    hash: hashToken(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
}

/** Compare two hex digests without leaking position information through timing. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Short, human-friendly id for reference numbers and idempotency keys. */
export function shortId(length = 12): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length).toUpperCase();
}
