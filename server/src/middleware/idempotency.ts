import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Types } from 'mongoose';
import { AppError, badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { IdempotencyRecord } from '../models/index.js';

/**
 * Exactly-once creates over an unreliable network (§Phase 15 follow-up).
 *
 * A write that carries an `Idempotency-Key` header is performed at most once per
 * (user, key). The first request runs normally and its successful response is stored;
 * a repeat with the same key and the same request returns that stored response
 * (`Idempotent-Replay: true`) without touching the ledger again. This is what makes it
 * safe for the client to queue a create while offline and replay it later — including
 * the nasty case where the original request *did* reach the server and only the
 * response was lost.
 *
 * Rules:
 *  - Same key + a different request (method, path, workspace or body) is refused (422);
 *    a key is an identity for one specific operation, not a reusable token.
 *  - A repeat that arrives while the first is still running gets 409
 *    `IDEMPOTENCY_IN_PROGRESS` — the caller should retry shortly, never assume failure.
 *  - Only 2xx responses are remembered. A rejected request (validation, permission,
 *    insufficient funds) is forgotten so the user can correct it and try again.
 *  - It applies only to the user the access token names. A forged or missing token skips
 *    this layer entirely and is rejected by the real authentication that follows.
 *  - Uploads (multipart) are not supported and bypass it.
 */
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function requestFingerprint(req: Request): string {
  const body = req.body && Object.keys(req.body).length > 0 ? JSON.stringify(req.body) : '';
  return crypto
    .createHash('sha256')
    .update([req.method, req.originalUrl.split('?')[0], req.get('x-workspace-id') ?? '', body].join('\n'))
    .digest('hex');
}

export const idempotency: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!MUTATING.has(req.method)) return next();
    const key = req.get('idempotency-key');
    if (!key) return next();
    if ((req.get('content-type') ?? '').startsWith('multipart/')) return next();

    const header = req.get('authorization');
    if (!header?.startsWith('Bearer ')) return next();
    let userId: Types.ObjectId;
    try {
      userId = new Types.ObjectId(verifyAccessToken(header.slice(7).trim()).sub);
    } catch {
      return next(); // real authentication will reject it
    }

    if (!KEY_PATTERN.test(key)) {
      throw badRequest('That Idempotency-Key is not valid. Use 8–128 letters, digits, "-", "_", "." or ":".');
    }

    const fingerprint = requestFingerprint(req);

    let record;
    try {
      record = await IdempotencyRecord.create({ userId, key, fingerprint, state: 'pending' });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      const existing = await IdempotencyRecord.findOne({ userId, key }).lean();
      if (!existing) return next(new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'That request is still being processed. Please retry in a moment.'));
      if (existing.fingerprint !== fingerprint) {
        throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'That Idempotency-Key was already used for a different request.');
      }
      if (existing.state === 'done') {
        res.setHeader('Idempotent-Replay', 'true');
        if (existing.statusCode === 204 || existing.body === undefined) return void res.status(existing.statusCode ?? 204).end();
        return void res.status(existing.statusCode ?? 200).json(existing.body);
      }
      throw new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'That request is still being processed. Please retry in a moment.');
    }

    // Capture the outcome. The record is settled *before* the response is sent, so a
    // client that retries the instant it receives the reply always finds it.
    let settled = false;
    const settle = (statusCode: number, body: unknown): Promise<unknown> => {
      if (settled) return Promise.resolve();
      settled = true;
      // Store exactly what the client will receive: the JSON text, not live documents or Dates.
      const plain = body === undefined ? undefined : (JSON.parse(JSON.stringify(body)) as unknown);
      const operation =
        statusCode >= 200 && statusCode < 300
          ? IdempotencyRecord.updateOne({ _id: record._id }, { state: 'done', statusCode, ...(plain === undefined ? {} : { body: plain }) })
          : IdempotencyRecord.deleteOne({ _id: record._id });
      return operation.catch((err) => logger.error({ err, key }, 'Could not settle an idempotency record'));
    };

    const json = res.json.bind(res);
    res.json = (body?: unknown) => {
      void settle(res.statusCode, body).then(() => json(body));
      return res;
    };
    const end = res.end.bind(res) as (...args: unknown[]) => Response;
    res.end = ((...args: unknown[]) => {
      if (settled) return end(...args);
      void settle(res.statusCode, undefined).then(() => end(...args));
      return res;
    }) as Response['end'];

    next();
  } catch (err) {
    next(err);
  }
};
