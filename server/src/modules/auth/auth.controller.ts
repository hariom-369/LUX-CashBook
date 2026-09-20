import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env.js';
import { created, ok } from '../../lib/http.js';
import { badRequest, unauthorized } from '../../lib/errors.js';
import { actorOf } from '../../middleware/auth.js';
import { userIdOf } from '../../middleware/context.js';
import { passwordStrength } from '../../lib/password.js';
import * as authService from './auth.service.js';

const REFRESH_COOKIE = 'khata_rt';

/**
 * The refresh cookie.
 *
 * `httpOnly` keeps it out of reach of any script on the page. `SameSite` is
 * `strict` by default — a third-party site cannot cause the browser to attach
 * it, so the refresh endpoint needs no separate CSRF token — but becomes `none`
 * when `COOKIE_CROSS_SITE=true` (frontend and API on different domains, e.g.
 * Vercel + Render), because `strict` and even `lax` cookies are never sent on a
 * cross-site `fetch`/XHR at all, which would otherwise make `/auth/refresh` fail
 * on every deployment split across two domains. `none` still requires no extra
 * CSRF protection here specifically because the actual authorization on every
 * other endpoint is the bearer access token from the `Authorization` header —
 * never automatically attached by a browser the way a cookie is — and CORS only
 * allows the exact origins in `env.corsOrigins`, so another site cannot complete
 * a cross-origin call to this API and read the result even with the cookie sent.
 * `path` scopes it to the auth routes, so it is not sent with every ordinary API
 * call either way.
 */
function refreshCookieOptions(expires: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: '/api/v1/auth',
    expires,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions(expiresAt));
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(new Date(0)), expires: undefined });
}

export async function register(req: Request, res: Response): Promise<void> {
  const result = await authService.register(req.body, actorOf(req));
  setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
  created(res, result.session);
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body;
  const result = await authService.login(email, password, actorOf(req));
  setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
  ok(res, result.session);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) {
    throw unauthorized('Your session has ended. Please sign in again.', 'NO_REFRESH_TOKEN');
  }

  try {
    const result = await authService.refreshSession(token, actorOf(req));
    setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
    ok(res, result.session);
  } catch (err) {
    // A dead refresh token should leave no cookie behind to retry with.
    clearRefreshCookie(res);
    throw err;
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(req.cookies?.[REFRESH_COOKIE]);
  clearRefreshCookie(res);
  ok(res, { signedOut: true });
}

export async function logoutAll(req: Request, res: Response): Promise<void> {
  await authService.logoutAllSessions(userIdOf(req));
  clearRefreshCookie(res);
  ok(res, { signedOut: true });
}

export async function me(req: Request, res: Response): Promise<void> {
  const session = await authService.buildSessionForUser(userIdOf(req));
  ok(res, session);
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  await authService.requestPasswordReset(req.body.email);
  // Deliberately identical whether or not the address exists (§69).
  ok(res, {
    message: 'If an account exists for that address, a reset link is on its way.',
  });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  await authService.resetPassword(req.body.token, req.body.password);
  ok(res, { message: 'Your password has been changed. Please sign in.' });
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  await authService.verifyEmail(req.body.token);
  ok(res, { verified: true });
}

export async function resendVerification(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) throw unauthorized();
  if (user.emailVerified) {
    throw badRequest('Your email address is already confirmed.');
  }
  await authService.sendVerificationEmail(user._id);
  ok(res, { message: 'Confirmation email sent.' });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  await authService.changePassword(userIdOf(req), req.body.currentPassword, req.body.newPassword);
  clearRefreshCookie(res);
  ok(res, { message: 'Password changed. Please sign in again.' });
}

export async function setPin(req: Request, res: Response): Promise<void> {
  await authService.setPin(userIdOf(req), req.body.pin, req.body.password);
  ok(res, { pinEnabled: true });
}

export async function removePin(req: Request, res: Response): Promise<void> {
  await authService.removePin(userIdOf(req), req.body.password);
  ok(res, { pinEnabled: false });
}

export async function verifyPin(req: Request, res: Response): Promise<void> {
  const valid = await authService.verifyPin(userIdOf(req), req.body.pin);
  if (!valid) {
    throw unauthorized('That PIN is not correct.', 'INVALID_PIN');
  }
  ok(res, { unlocked: true });
}

/** Live strength feedback for the sign-up form. Does not touch the database. */
export function checkPasswordStrength(req: Request, res: Response): void {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  ok(res, passwordStrength(password));
}
