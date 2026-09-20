import mongoose, { type ClientSession } from 'mongoose';
import { supportsTransactions } from '../config/db.js';
import { logger } from './logger.js';

/**
 * Atomicity helper (invariant I9).
 *
 * Most financial writes in this system are deliberately *single-document* — a
 * transfer is one `Transaction` with two postings, not two documents — precisely
 * so that atomicity is free and a half-applied transfer is unrepresentable.
 *
 * A few operations genuinely span documents (settling a person, posting a batch of
 * recurring transactions, restoring a backup). Those run through here. On a replica
 * set they get a real multi-document transaction; on a standalone `mongod` they run
 * sequentially and the caller's registered compensations undo the work on failure.
 */
export interface UnitOfWork {
  session: ClientSession | undefined;
  /**
   * Register an undo step for the fallback path. Ignored when a real transaction
   * is in play, because the database will roll back for us.
   */
  onRollback(fn: () => Promise<void>): void;
}

export async function withTransaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
  if (!supportsTransactions()) {
    return runWithCompensation(fn);
  }

  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn({ session, onRollback: () => {} });
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function runWithCompensation<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
  const compensations: Array<() => Promise<void>> = [];
  const uow: UnitOfWork = {
    session: undefined,
    onRollback(step) {
      compensations.push(step);
    },
  };

  try {
    return await fn(uow);
  } catch (err) {
    // Undo in reverse order, and never let a failed compensation mask the original error.
    for (const step of compensations.reverse()) {
      try {
        await step();
      } catch (compensationError) {
        logger.error(
          { err: compensationError },
          'Compensating rollback failed — data may need manual reconciliation',
        );
      }
    }
    throw err;
  }
}

/** Convenience for read paths that want to participate in an open transaction. */
export function sessionOption(uow?: UnitOfWork) {
  return uow?.session ? { session: uow.session } : {};
}
