import { Types } from 'mongoose';
import { INCOME_TYPES, EXPENSE_TYPES, type TagSummaryDto } from '@khata/shared';
import { Attachment, Payee, Transaction } from '../../models/index.js';
import type { RequestScope } from '../../middleware/context.js';
import { badRequest } from '../../lib/errors.js';
import { excludeHiddenTransactions } from '../../services/accountVisibility.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';

/**
 * Tag management (§Phase 2): list, rename, merge and delete tags across everything that carries
 * them. Tags are plain labels on a transaction — changing one never touches an amount, an account
 * or a balance — so these are metadata edits. Each edited transaction gets its `rev` bumped, so an
 * editor holding an older copy is told "someone changed this" rather than silently overwriting.
 *
 * A viewer only ever lists, counts or edits tags on transactions they can see (private-account
 * transactions of other members are left exactly as they are).
 */

export const MAX_TAG_LENGTH = 40;

/** Same rule the models apply on write: trimmed, lowercase, non-empty. */
export function normalizeTag(raw: string): string {
  const tag = String(raw).trim().toLowerCase();
  if (!tag) throw badRequest('A tag cannot be empty.');
  if (tag.length > MAX_TAG_LENGTH) throw badRequest(`A tag can be at most ${MAX_TAG_LENGTH} characters.`);
  return tag;
}

export async function listTags(scope: RequestScope): Promise<TagSummaryDto[]> {
  const rows = await Transaction.aggregate<{
    _id: string;
    count: number;
    income: number;
    expense: number;
    last: Date;
  }>([
    { $match: { workspaceId: scope.workspaceId, deletedAt: null, 'tags.0': { $exists: true }, ...excludeHiddenTransactions(scope) } },
    { $unwind: '$tags' },
    {
      $group: {
        _id: '$tags',
        count: { $sum: 1 },
        income: { $sum: { $cond: [{ $in: ['$type', [...INCOME_TYPES]] }, '$amountMinor', 0] } },
        expense: { $sum: { $cond: [{ $in: ['$type', [...EXPENSE_TYPES]] }, '$amountMinor', 0] } },
        last: { $max: '$date' },
      },
    },
    { $sort: { count: -1, _id: 1 } },
  ]);

  return rows.map((row) => ({
    tag: row._id,
    transactionCount: row.count,
    incomeMinor: row.income,
    expenseMinor: row.expense,
    lastUsedAt: row.last?.toISOString(),
  }));
}

/** Replace every occurrence of any tag in `from` with `to` (or just drop them when `to` is null). */
async function replaceTags(scope: RequestScope, from: string[], to: string | null): Promise<{ transactions: number; payees: number; documents: number }> {
  const pipeline = (collectionIsTransaction: boolean) => [
    {
      $set: {
        tags: {
          $setUnion: [
            { $filter: { input: '$tags', cond: { $not: [{ $in: ['$$this', from] }] } } },
            to ? [to] : [],
          ],
        },
        ...(collectionIsTransaction ? { rev: { $add: [{ $ifNull: ['$rev', 0] }, 1] } } : {}),
      },
    },
  ];

  const transactions = await Transaction.updateMany(
    { workspaceId: scope.workspaceId, tags: { $in: from }, ...excludeHiddenTransactions(scope) },
    pipeline(true),
  );
  const payees = await Payee.updateMany({ workspaceId: scope.workspaceId, tags: { $in: from } }, pipeline(false));
  const documents = await Attachment.updateMany({ workspaceId: scope.workspaceId, tags: { $in: from } }, pipeline(false));
  return { transactions: transactions.modifiedCount, payees: payees.modifiedCount, documents: documents.modifiedCount };
}

export async function renameTag(scope: RequestScope, fromRaw: string, toRaw: string, audit: AuditContext) {
  const from = normalizeTag(fromRaw);
  const to = normalizeTag(toRaw);
  if (from === to) throw badRequest('That is already the tag\'s name.');
  const result = await replaceTags(scope, [from], to);
  await recordAudit(audit, { action: 'updated', entityType: 'Tag', entityId: from, summary: `Renamed tag "${from}" to "${to}" (${result.transactions} transactions)` });
  return result;
}

export async function mergeTags(scope: RequestScope, sourcesRaw: string[], targetRaw: string, audit: AuditContext) {
  const target = normalizeTag(targetRaw);
  const sources = [...new Set(sourcesRaw.map(normalizeTag))].filter((t) => t !== target);
  if (sources.length === 0) throw badRequest('Choose at least one other tag to merge into this one.');
  const result = await replaceTags(scope, sources, target);
  await recordAudit(audit, {
    action: 'updated',
    entityType: 'Tag',
    entityId: target,
    summary: `Merged ${sources.map((s) => `"${s}"`).join(', ')} into "${target}" (${result.transactions} transactions)`,
  });
  return result;
}

export async function deleteTag(scope: RequestScope, tagRaw: string, audit: AuditContext) {
  const tag = normalizeTag(tagRaw);
  const result = await replaceTags(scope, [tag], null);
  await recordAudit(audit, { action: 'deleted', entityType: 'Tag', entityId: tag, summary: `Removed tag "${tag}" from ${result.transactions} transactions` });
  return result;
}

/**
 * Spending and income by tag over a period (§Phase 2 "tag report"). A transaction with several tags
 * is counted under each of them - tags are overlapping labels, not a partition - so the rows are
 * not meant to add up to the period total; the response says so via `overlapping: true`.
 */
export async function getTagReport(scope: RequestScope, from: Date, to: Date): Promise<{ rows: TagSummaryDto[]; overlapping: true }> {
  const rows = await Transaction.aggregate<{ _id: string; count: number; income: number; expense: number; last: Date }>([
    {
      $match: {
        workspaceId: scope.workspaceId,
        deletedAt: null,
        date: { $gte: from, $lte: to },
        type: { $in: [...INCOME_TYPES, ...EXPENSE_TYPES] },
        'tags.0': { $exists: true },
        ...excludeHiddenTransactions(scope),
      },
    },
    { $unwind: '$tags' },
    {
      $group: {
        _id: '$tags',
        count: { $sum: 1 },
        income: { $sum: { $cond: [{ $in: ['$type', [...INCOME_TYPES]] }, '$amountMinor', 0] } },
        expense: { $sum: { $cond: [{ $in: ['$type', [...EXPENSE_TYPES]] }, '$amountMinor', 0] } },
        last: { $max: '$date' },
      },
    },
    { $sort: { expense: -1, _id: 1 } },
  ]);
  return {
    overlapping: true,
    rows: rows.map((r) => ({ tag: r._id, transactionCount: r.count, incomeMinor: r.income, expenseMinor: r.expense, lastUsedAt: r.last.toISOString() })),
  };
}

export const isObjectId = (value: string): boolean => Types.ObjectId.isValid(value);
