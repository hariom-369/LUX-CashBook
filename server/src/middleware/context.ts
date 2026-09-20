import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import type { Types } from 'mongoose';
import type { IUser, IWorkspace } from '../models/index.js';

/**
 * Request-scoped context.
 *
 * `scope` is the object that enforces invariant I8 in practice: services take it as
 * their first argument, so there is no way to write a query that forgets to filter
 * by user and workspace — the type system will not let you call the function.
 */
export interface RequestScope {
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  currency: string;
  mode: IWorkspace['mode'];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // `id` is deliberately not declared here: pino-http already augments
      // IncomingMessage with `id: ReqId`, and a second declaration would conflict.
      // Read it through `reqId()` below instead.
      user?: IUser & { _id: Types.ObjectId };
      sessionId?: string;
      workspace?: IWorkspace & { _id: Types.ObjectId };
      scope?: RequestScope;
    }
  }
}

/**
 * Attach a request id, echoed in logs and in error responses so a user can quote
 * one to support and have the exact request found.
 *
 * An inbound `X-Request-Id` is honoured only when it looks like an id — otherwise
 * a caller could inject arbitrary text into our log lines.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('x-request-id');
  const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
}

/** pino-http types `req.id` as `string | number`; the API always reports a string. */
export function reqId(req: Request): string {
  return String(req.id ?? '');
}

/**
 * Read a route parameter as a string.
 *
 * Express 5 types params as `string | string[]` because a wildcard segment can
 * repeat. Every route in this API uses single-segment params validated by Zod, so
 * this narrows once here instead of at ~40 call sites.
 */
export function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

/** Narrow `req.scope` for handlers that run behind `requireWorkspace`. */
export function scopeOf(req: Request): RequestScope {
  if (!req.scope) {
    // Unreachable behind the middleware chain; throwing keeps the type honest and
    // turns a routing mistake into a loud failure rather than an unscoped query.
    throw new Error('Route is missing requireWorkspace middleware.');
  }
  return req.scope;
}

export function userIdOf(req: Request): Types.ObjectId {
  if (!req.user) throw new Error('Route is missing requireAuth middleware.');
  return req.user._id;
}
