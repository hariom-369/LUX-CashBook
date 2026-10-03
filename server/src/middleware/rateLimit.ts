import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../config/env.js';
import { tooManyRequests } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';

/**
 * Rate limiting (§37, §69).
 *
 * Authenticated traffic is keyed by user id rather than IP, so one user behind a
 * shared NAT cannot exhaust the budget for everyone else on it — and so a single
 * attacker cannot dodge the limit by rotating addresses once they hold a token.
 * (Until §Phase 16 follow-up this was true only of the per-route limiters: the
 * global one ran before authentication and so always keyed by IP.)
 */
export function rateLimitKey(req: Request): string {
  if (req.user?._id) return `u:${String(req.user._id)}`;
  // `globalLimiter` runs before authentication, so `req.user` is not set yet. Read the
  // caller from the bearer token instead: the check is purely cryptographic (no database
  // access) and a forged, expired or absent token falls through to the IP bucket — so
  // users behind one NAT or carrier-grade NAT each get their own budget, and nobody can
  // claim someone else's by guessing a user id.
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) {
    try {
      return `u:${verifyAccessToken(header.slice(7).trim()).sub}`;
    } catch {
      /* unauthenticated or expired — rate limited by address below */
    }
  }
  return `ip:${req.ip ?? 'unknown'}`;
}

const shared: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  handler: (_req, _res, next) => next(tooManyRequests()),
  // The limiter should never be the reason a request fails; log and allow.
  skip: () => env.isTest,
};

/** Baseline limit applied to the whole API. */
export const globalLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: env.RATE_LIMIT_MAX,
});

/**
 * Credential endpoints. Tight, and keyed by IP *and* the submitted email so that
 * spraying one password across many accounts is limited too, not just repeated
 * attempts against one account.
 */
export const authLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: env.AUTH_RATE_LIMIT_MAX,
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
    return `auth:${req.ip ?? 'unknown'}:${email}`;
  },
  handler: (_req, _res, next) =>
    next(tooManyRequests('Too many attempts. Please wait a few minutes before trying again.')),
});

/** Password reset and verification resends — expensive (email) and abusable. */
export const emailLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  handler: (_req, _res, next) =>
    next(tooManyRequests('Too many requests. Please try again in an hour.')),
});

/** Writes are cheap individually but a runaway client shouldn't flood the ledger. */
export const writeLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 120,
});

/** Report generation and exports do real work. */
export const reportLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 30,
  handler: (_req, _res, next) =>
    next(tooManyRequests('That report is still being prepared. Please wait a moment.')),
});

export const uploadLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 30,
});
