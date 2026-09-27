/**
 * One-time backfill for the `rev` field added in Phase 1
 * (docs/FEATURE_ROADMAP.md, decision 2 / docs/PHASE1_NOTES.md).
 *
 * Not required for correctness — `claimRevision` (lib/revision.ts) already
 * treats a missing `rev` as `0`, and the schema default (`default: 0`) applies
 * to every document saved from here on regardless. This exists so that:
 *
 *   1. Every existing document actually has the field stored (queries that
 *      project or index on `rev` behave the same for old and new records).
 *   2. An operator can see, before running it, exactly how many documents
 *      across which collections are affected.
 *
 * Idempotent: only touches documents where `rev` doesn't exist yet, so running
 * it twice (or against a database with a mix of already-backfilled and legacy
 * documents) is safe.
 *
 * `runBackfill` is the testable core (see tests/backfillRevisions.test.ts,
 * which runs it against the suite's real in-process MongoDB); the CLI below
 * is a thin wrapper that owns the database connection.
 *
 * Usage:
 *   tsx src/scripts/backfillRevisions.ts            # dry run — counts only
 *   tsx src/scripts/backfillRevisions.ts --apply     # actually writes
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { logger } from '../lib/logger.js';
import { Account, Budget, Person, RecurringTransaction, SavingsGoal, Transaction } from '../models/index.js';

const MODELS = { Transaction, Account, Person, Budget, SavingsGoal, RecurringTransaction } as const;

export interface BackfillResult {
  model: string;
  missing: number;
  /** Set only when `apply` was true. */
  modified?: number;
}

/** Requires an already-open Mongoose connection; does not manage one itself. */
export async function runBackfill(apply: boolean): Promise<BackfillResult[]> {
  const results: BackfillResult[] = [];

  for (const [name, model] of Object.entries(MODELS)) {
    const filter = { rev: { $exists: false } };
    const missing = await model.countDocuments(filter);

    if (missing === 0) {
      results.push({ model: name, missing: 0 });
      continue;
    }

    if (!apply) {
      results.push({ model: name, missing });
      continue;
    }

    const result = await model.updateMany(filter, { $set: { rev: 0 } });
    results.push({ model: name, missing, modified: result.modifiedCount });
  }

  return results;
}

async function cli() {
  const apply = process.argv.includes('--apply');
  const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
  await connectDatabase();

  const results = await runBackfill(apply);
  for (const r of results) {
    if (r.missing === 0) {
      logger.info({ model: r.model }, 'Nothing to backfill');
    } else if (apply) {
      logger.info({ model: r.model, missing: r.missing, modified: r.modified }, 'Backfilled rev');
    } else {
      logger.info({ model: r.model, missing: r.missing }, 'Would backfill (dry run — pass --apply to write)');
    }
  }

  const totalMissing = results.reduce((sum, r) => sum + r.missing, 0);
  if (!apply && totalMissing > 0) {
    logger.info({ totalMissing }, 'Dry run complete. Re-run with --apply to write.');
  } else if (apply) {
    logger.info('Backfill complete.');
  } else {
    logger.info('Nothing needed backfilling — every document already has rev.');
  }

  await disconnectDatabase();
}

// Only run the CLI when this file is executed directly (`tsx backfillRevisions.ts`),
// not when `runBackfill` is imported by a test. Resolved with `path.resolve`
// (not a raw string/URL comparison) so Windows path separators and drive-letter
// casing can't make this wrongly true or false.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  cli().catch((err) => {
    logger.error({ err }, 'Backfill failed');
    process.exitCode = 1;
  });
}
