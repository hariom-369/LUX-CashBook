import type { Types } from 'mongoose';
import { Counter } from '../models/index.js';
import type { UnitOfWork } from '../lib/transaction.js';

const PREFIXES: Record<'invoice' | 'quotation', string> = { invoice: 'INV', quotation: 'QUO' };

/**
 * The next sequential number for an invoice or quotation (§Phase 11), scoped
 * to `{workspace, docType, year}` so numbering resets each calendar year —
 * the convention every sample Indian invoice format already follows.
 *
 * The `$inc` is atomic and, when called inside the same `withTransaction`
 * that creates the document, commits or rolls back with it — two concurrent
 * requests can never be handed the same number, and a failed invoice create
 * never burns a number it didn't end up using.
 */
export async function nextDocumentNumber(
  workspaceId: Types.ObjectId,
  docType: 'invoice' | 'quotation',
  uow?: UnitOfWork,
): Promise<string> {
  const year = new Date().getFullYear();
  const counter = await Counter.findOneAndUpdate(
    { workspaceId, docType, year },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session: uow?.session },
  );
  return `${PREFIXES[docType]}-${year}-${String(counter.seq).padStart(5, '0')}`;
}
