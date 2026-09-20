import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Types } from 'mongoose';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { User, Workspace } from '../models/index.js';
import { reqId, type RequestScope } from './context.js';

/**
 * Authenticate the caller.
 *
 * The token is checked cryptographically first (cheap, no I/O) and only then is the
 * user loaded — so an invalid token costs nothing and cannot be used to probe the
 * database. `tokenVersion` is compared on every request, which is how a password
 * change or "sign out everywhere" kills live access tokens before they expire.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      throw unauthorized('Please sign in to continue.', 'NO_TOKEN');
    }

    const claims = verifyAccessToken(token);

    const user = await User.findById(claims.sub);
    if (!user) {
      throw unauthorized('Your account could not be found. Please sign in again.', 'USER_NOT_FOUND');
    }
    if (user.tokenVersion !== claims.tv) {
      throw unauthorized('Your session ended because your password changed.', 'TOKEN_REVOKED');
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw forbidden('This account is temporarily locked. Try again shortly.');
    }

    req.user = user as Request['user'];
    req.sessionId = claims.sid;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Resolve the active workspace and produce the scope every service requires
 * (invariant I8).
 *
 * The workspace comes from an explicit `X-Workspace-Id` header when present,
 * otherwise from the user's saved active workspace. Either way, ownership is
 * re-verified against the database on every request — a client-supplied id is a
 * *request*, never a grant. This is the check that makes IDOR against another
 * user's workspace impossible.
 */
export const requireWorkspace: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.user) throw unauthorized();

    const requested = req.get('x-workspace-id') ?? (req.query.workspaceId as string | undefined);
    const workspaceId = requested ?? (req.user.activeWorkspaceId ? String(req.user.activeWorkspaceId) : null);

    if (!workspaceId) {
      throw notFound('Workspace');
    }
    if (!Types.ObjectId.isValid(workspaceId)) {
      throw forbidden('That workspace reference is not valid.');
    }

    const workspace = await Workspace.findOne({
      _id: new Types.ObjectId(workspaceId),
      userId: req.user._id,
    });

    if (!workspace) {
      // Deliberately the same response as "belongs to someone else": we do not
      // confirm the existence of workspaces the caller cannot see.
      throw notFound('Workspace');
    }

    const scope: RequestScope = {
      userId: req.user._id,
      workspaceId: workspace._id,
      currency: workspace.currency,
      mode: workspace.mode,
    };

    req.workspace = workspace as Request['workspace'];
    req.scope = scope;
    next();
  } catch (err) {
    next(err);
  }
};

/** Gate business-only endpoints (petty cash, daily closing, customers, suppliers). */
export const requireBusinessMode: RequestHandler = (req, _res, next) => {
  if (req.scope?.mode !== 'business') {
    return next(forbidden('This feature is available in a business workspace.'));
  }
  next();
};

/** Some flows (changing email, exporting all data) should require a verified address. */
export const requireVerifiedEmail: RequestHandler = (req, _res, next) => {
  if (!req.user?.emailVerified) {
    return next(forbidden('Confirm your email address first.'));
  }
  next();
};

/**
 * Populate `req.user` when a token is present but do not fail when it is absent.
 * Used by routes that behave differently for signed-in callers without requiring it.
 */
export const optionalAuth: RequestHandler = async (req, res, next) => {
  if (!extractToken(req)) return next();
  return requireAuth(req, res, (err?: unknown) => (err ? next() : next()));
};

function extractToken(req: Request): string | null {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) {
    return header.slice(7).trim() || null;
  }
  return null;
}

/** Log an authenticated action's actor details for the audit trail. */
export function actorOf(req: Request): { ipAddress?: string; userAgent?: string; requestId?: string } {
  return {
    ipAddress: req.ip,
    userAgent: req.get('user-agent')?.slice(0, 256),
    requestId: reqId(req),
  };
}

export type { Response, NextFunction };
