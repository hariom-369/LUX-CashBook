import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, z } from 'zod';

/**
 * Validate and *replace* the request parts with their parsed values.
 *
 * Replacing rather than merely checking is the point: downstream code then works
 * with coerced, stripped, correctly typed data, and an unexpected extra field in a
 * payload cannot reach a database write.
 */
export interface ValidationTargets {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate(targets: ValidationTargets): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (targets.body) {
        req.body = targets.body.parse(req.body ?? {});
      }
      if (targets.params) {
        req.params = targets.params.parse(req.params ?? {}) as typeof req.params;
      }
      if (targets.query) {
        const parsed = targets.query.parse(req.query ?? {});
        // Express 5 exposes `req.query` as a getter, so assign onto a own-property
        // shadow rather than trying to set the accessor.
        Object.defineProperty(req, 'query', {
          value: parsed,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
      next();
    } catch (err) {
      next(err instanceof ZodError ? err : err);
    }
  };
}

// ─────────────────────────────────────────────── Reusable primitives

/** A MongoDB ObjectId as it appears in a URL or payload. */
export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'That reference is not valid.');

export const idParamSchema = z.object({ id: objectIdSchema });

/**
 * An amount in minor units. Rejects floats explicitly rather than rounding them —
 * a client sending 10.5 paise has a bug, and silently accepting it would put a
 * fractional value into the ledger.
 */
export const amountMinorSchema = z
  .number({ invalid_type_error: 'Enter a valid amount.' })
  .int('Amounts must be whole units — check the decimal places.')
  .refine((n) => Math.abs(n) <= 1_000_000_000_000_00, 'That amount is too large.');

export const positiveAmountSchema = amountMinorSchema.refine(
  (n) => n > 0,
  'Enter an amount greater than zero.',
);

/** ISO date string or timestamp → Date. */
export const dateSchema = z
  .union([z.string(), z.number(), z.date()])
  .transform((v, ctx) => {
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid date.' });
      return z.NEVER;
    }
    return d;
  });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

/** Comma-separated query list → array, e.g. `?types=income,expense`. */
export function csvArray<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .union([z.string(), z.array(z.enum(values))])
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      const list = Array.isArray(v) ? v : v.split(',').map((s) => s.trim()).filter(Boolean);
      return list.filter((s): s is T[number] => (values as readonly string[]).includes(s));
    });
}

export const csvObjectIds = z
  .union([z.string(), z.array(objectIdSchema)])
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    const list = Array.isArray(v) ? v : v.split(',').map((s) => s.trim()).filter(Boolean);
    return list.filter((s) => /^[a-f\d]{24}$/i.test(s));
  });

/** Trimmed, length-capped free text. Empty string becomes `undefined`. */
export function text(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .optional()
    .transform((v) => (v === '' ? undefined : v));
}

export const tagsSchema = z
  .array(z.string().trim().min(1).max(30))
  .max(20, 'Up to 20 tags.')
  .optional()
  .transform((v) => v ?? []);
