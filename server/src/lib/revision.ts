import type { ClientSession, Model, Types } from 'mongoose';
import { conflict } from './errors.js';

/**
 * Optimistic concurrency for user edits (docs/FEATURE_ROADMAP.md, decision 2).
 *
 * Every editable financial record carries `rev`, bumped only by a user edit —
 * never by internal bookkeeping such as balance caches or repayment totals. An
 * editor sends back the `rev` it read; if someone else saved in between, the edit
 * is refused with 409 instead of silently overwriting their change.
 *
 * Call it immediately before persisting, after the edit has been validated, so a
 * request that fails validation never consumes a revision. The claim is a single
 * conditional update, so two simultaneous edits of the same revision can't both
 * win. A record created before `rev` existed counts as revision 0.
 *
 * Without an expected revision (an older client) it only bumps, which keeps the
 * previous last-write-wins behaviour for those callers.
 */
export async function claimRevision<T>(
  model: Model<T>,
  doc: { _id: Types.ObjectId; rev?: number | null },
  expectedRev: number | undefined,
  session?: ClientSession,
): Promise<void> {
  const loaded = doc.rev ?? 0;
  if (expectedRev !== undefined && expectedRev !== loaded) throw staleRevision();

  const filter =
    expectedRev === undefined
      ? { _id: doc._id }
      : { _id: doc._id, rev: loaded === 0 ? { $in: [0, null] } : loaded };

  const updated = (await model
    .findOneAndUpdate(filter as never, { $inc: { rev: 1 } } as never, { new: true, projection: { rev: 1 }, session })
    .lean()) as { rev?: number } | null;

  if (!updated) throw staleRevision();
  doc.rev = updated.rev ?? loaded + 1;
}

function staleRevision() {
  return conflict(
    'This was changed somewhere else after you opened it. Reload to see the latest version, then make your change again.',
    'STALE_REVISION',
  );
}
