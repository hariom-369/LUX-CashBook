/**
 * One-time backfill for household workspaces (§Phase 9, decision 4).
 *
 * `requireWorkspace` now grants access by `WorkspaceMember`, not
 * `Workspace.userId` — so every workspace that existed before this phase
 * needs an owner membership row created, or its own owner would be locked
 * out. New workspaces don't need this: `createWorkspace` has created the
 * owner's membership row itself since this phase shipped.
 *
 * Idempotent: only creates a membership for a workspace that doesn't already
 * have one for its `userId`, so running it twice (or against a database with
 * a mix of already-migrated and legacy workspaces) is safe.
 *
 * `runBackfill` is the testable core (see tests/backfillWorkspaceMembers.test.ts,
 * which runs it against the suite's real in-process MongoDB); the CLI below
 * is a thin wrapper that owns the database connection.
 *
 * Usage:
 *   tsx src/scripts/backfillWorkspaceMembers.ts            # dry run — counts only
 *   tsx src/scripts/backfillWorkspaceMembers.ts --apply     # actually writes
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { logger } from '../lib/logger.js';
import { Workspace, WorkspaceMember } from '../models/index.js';

export interface BackfillResult {
  missing: number;
  /** Set only when `apply` was true. */
  created?: number;
}

/** Requires an already-open Mongoose connection; does not manage one itself. */
export async function runBackfill(apply: boolean): Promise<BackfillResult> {
  const workspaces = await Workspace.find().select('_id userId isDefault').lean();
  if (workspaces.length === 0) return { missing: 0 };

  const existing = await WorkspaceMember.find({ workspaceId: { $in: workspaces.map((w) => w._id) } })
    .select('workspaceId userId')
    .lean();
  const existingKeys = new Set(existing.map((m) => `${m.workspaceId}:${m.userId}`));

  const missing = workspaces.filter((w) => !existingKeys.has(`${w._id}:${w.userId}`));
  if (missing.length === 0) return { missing: 0 };
  if (!apply) return { missing: missing.length };

  const result = await WorkspaceMember.insertMany(
    missing.map((w) => ({
      workspaceId: w._id,
      userId: w.userId,
      role: 'owner' as const,
      isDefault: w.isDefault,
      joinedAt: new Date(),
    })),
    { ordered: false },
  );

  return { missing: missing.length, created: result.length };
}

async function cli() {
  const apply = process.argv.includes('--apply');
  const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
  await connectDatabase();

  const result = await runBackfill(apply);
  if (result.missing === 0) {
    logger.info('Nothing to backfill — every workspace already has an owner membership.');
  } else if (apply) {
    logger.info({ missing: result.missing, created: result.created }, 'Backfilled owner memberships');
  } else {
    logger.info({ missing: result.missing }, 'Would backfill (dry run — pass --apply to write)');
  }

  await disconnectDatabase();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  cli().catch((err) => {
    logger.error({ err }, 'Backfill failed');
    process.exitCode = 1;
  });
}
