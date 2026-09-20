import type { ApiFieldError } from '@khata/shared';

/**
 * Application errors.
 *
 * Every error that reaches a user goes through this class, which is how §57 gets
 * satisfied: `message` is always something a human can read and act on, and raw
 * driver/stack detail never leaves the server. `code` is the stable identifier the
 * client switches on.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly fields?: ApiFieldError[];
  /** Expected errors (validation, not-found) are logged at `warn`, not `error`. */
  readonly isOperational: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { fields?: ApiFieldError[]; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.fields = options.fields;
    this.details = options.details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (message: string, fields?: ApiFieldError[]) =>
  new AppError(400, 'BAD_REQUEST', message, { fields });

export const validationError = (message: string, fields: ApiFieldError[]) =>
  new AppError(422, 'VALIDATION_ERROR', message, { fields });

export const unauthorized = (message = 'Please sign in to continue.', code = 'UNAUTHORIZED') =>
  new AppError(401, code, message);

export const forbidden = (message = "You don't have access to this.") =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (what = 'Resource') =>
  new AppError(404, 'NOT_FOUND', `${what} not found.`);

export const conflict = (message: string, code = 'CONFLICT') =>
  new AppError(409, code, message);

export const tooManyRequests = (message = 'Too many attempts. Please try again in a few minutes.') =>
  new AppError(429, 'RATE_LIMITED', message);

export const internal = (message = 'Something went wrong on our side. Please try again.', cause?: unknown) =>
  new AppError(500, 'INTERNAL_ERROR', message, { cause });

/**
 * Domain-specific failures the UI reacts to individually. Having these as named
 * constructors keeps error strings out of service code and consistent across
 * every endpoint that can produce them.
 */
export const insufficientBalance = (accountName: string, availableFormatted: string) =>
  new AppError(
    422,
    'INSUFFICIENT_BALANCE',
    `${accountName} would go below zero. Available balance is ${availableFormatted}.`,
  );

export const invalidAmount = (message = 'Enter an amount greater than zero.') =>
  new AppError(422, 'INVALID_AMOUNT', message);

export const overRepayment = (outstandingFormatted: string) =>
  new AppError(
    422,
    'OVER_REPAYMENT',
    `That is more than the outstanding amount of ${outstandingFormatted}.`,
  );

export const periodClosed = (label: string) =>
  new AppError(
    409,
    'PERIOD_CLOSED',
    `${label} has been closed. Reopen it before recording or changing transactions in that period.`,
  );

export const duplicateSubmission = () =>
  new AppError(
    409,
    'DUPLICATE_SUBMISSION',
    'This looks like a duplicate of a transaction that was just saved.',
  );

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
