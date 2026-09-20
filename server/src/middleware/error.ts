import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import type { ApiError, ApiFieldError } from '@khata/shared';
import { AppError, isAppError } from '../lib/errors.js';
import { reqId } from './context.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

/**
 * The single exit point for every failure in the API.
 *
 * Its job is to make §57 true: whatever went wrong — a Zod failure, a duplicate key,
 * a cast error, a bug — the client receives a stable `code` and a sentence a person
 * can actually read. Driver messages, stack traces and query shapes never leave the
 * process.
 */
export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiError = {
    ok: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `No route matches ${req.method} ${req.path}.`,
      requestId: reqId(req),
    },
  };
  res.status(404).json(body);
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // Express identifies an error handler by its arity, so `next` must stay.
  _next: NextFunction,
): void {
  const normalized = normalize(err);

  const logPayload = {
    err,
    requestId: reqId(req),
    method: req.method,
    path: req.originalUrl,
    userId: req.user?._id ? String(req.user._id) : undefined,
    code: normalized.code,
  };

  if (normalized.statusCode >= 500) {
    logger.error(logPayload, normalized.message);
  } else if (normalized.statusCode === 429 || normalized.statusCode === 401) {
    logger.warn(logPayload, normalized.message);
  } else {
    logger.info(logPayload, normalized.message);
  }

  const body: ApiError = {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.fields?.length ? { fields: normalized.fields } : {}),
      requestId: reqId(req),
    },
  };

  // Stack traces only ever go to a developer's own console.
  if (!env.isProduction && normalized.statusCode >= 500 && err instanceof Error) {
    (body.error as Record<string, unknown>).stack = err.stack;
  }

  res.status(normalized.statusCode).json(body);
}

function normalize(err: unknown): AppError {
  if (isAppError(err)) return err;

  if (err instanceof ZodError) {
    return new AppError(422, 'VALIDATION_ERROR', 'Please check the highlighted fields.', {
      fields: zodFields(err),
    });
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const fields: ApiFieldError[] = Object.values(err.errors).map((e) => ({
      path: e.path,
      // Mongoose validator messages in this codebase are written for humans.
      message: e.message,
    }));
    return new AppError(422, 'VALIDATION_ERROR', fields[0]?.message ?? 'Please check the highlighted fields.', {
      fields,
    });
  }

  if (err instanceof mongoose.Error.CastError) {
    return new AppError(400, 'INVALID_ID', 'That record reference is not valid.');
  }

  if (isDuplicateKeyError(err)) {
    return new AppError(409, 'DUPLICATE', duplicateMessage(err));
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return new AppError(400, 'MALFORMED_JSON', 'The request body could not be read as JSON.');
  }

  if (err instanceof MulterError) {
    return new AppError(400, 'UPLOAD_ERROR', multerMessage(err));
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Please try again.', {
    cause: err,
  });
}

function zodFields(err: ZodError): ApiFieldError[] {
  return err.issues.map((issue) => ({
    // Drop the `body`/`query`/`params` container segment — the client only knows
    // about its own form field names.
    path: issue.path.slice(1).join('.') || issue.path.join('.'),
    message: issue.message,
  }));
}

function multerMessage(err: MulterError): string {
  if (err.code === 'LIMIT_FILE_SIZE') return 'That file is too large.';
  if (err.code === 'LIMIT_FILE_COUNT') return 'Only one file can be uploaded at a time.';
  if (err.code === 'LIMIT_UNEXPECTED_FILE') return 'Unexpected file field.';
  return 'That file could not be uploaded.';
}

function isDuplicateKeyError(err: unknown): err is { code: number; keyPattern?: Record<string, unknown> } {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/** Turn a duplicate-key violation into something worth reading. */
function duplicateMessage(err: { keyPattern?: Record<string, unknown> }): string {
  const keys = Object.keys(err.keyPattern ?? {});
  if (keys.includes('email')) return 'An account with that email already exists.';
  if (keys.includes('idempotencyKey')) return 'That transaction has already been saved.';
  if (keys.includes('name')) return 'Something with that name already exists here.';
  if (keys.includes('date')) return 'That day has already been closed.';
  if (keys.includes('sourceKey') || keys.includes('dedupeKey')) return 'That item already exists.';
  return 'That record already exists.';
}
