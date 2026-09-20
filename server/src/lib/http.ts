import type { Response } from 'express';
import type { ApiSuccess, Paginated } from '@khata/shared';

/** Every successful response in the API has this shape. No exceptions. */
export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>): Response {
  const body: ApiSuccess<T> = meta ? { ok: true, data, meta } : { ok: true, data };
  return res.json(body);
}

export function created<T>(res: Response, data: T, meta?: Record<string, unknown>): Response {
  return ok(res.status(201), data, meta);
}

export function noContent(res: Response): Response {
  return res.status(204).end();
}

export function paginate<T>(items: T[], total: number, page: number, limit: number): Paginated<T> {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    items,
    page,
    limit,
    total,
    totalPages,
    hasMore: page < totalPages,
  };
}

/**
 * Wrap an async handler so a rejected promise reaches the error middleware.
 * Express 5 forwards rejections itself, but being explicit keeps the behaviour
 * obvious at every call site and independent of the Express version.
 */
export function asyncHandler<T extends (...args: never[]) => Promise<unknown>>(fn: T): T {
  return (async (...args: Parameters<T>) => {
    const next = args[2] as unknown as (err?: unknown) => void;
    try {
      return await fn(...args);
    } catch (err) {
      next(err);
      return undefined;
    }
  }) as unknown as T;
}
