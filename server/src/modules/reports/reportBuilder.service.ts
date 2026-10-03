import { Types } from 'mongoose';
import { z } from 'zod';
import { RANGE_PRESETS, resolveRange, type ReportDefinition, type ReportResultDto, type ReportResultRowDto, type SavedReportDto } from '@khata/shared';
import { Account, Category, Payee, Person, SavedReport, Transaction } from '../../models/index.js';
import type { RequestScope } from '../../middleware/context.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { csvText } from '../../lib/csv.js';
import { stringify } from 'csv-stringify/sync';
import { buildFilter } from '../transactions/transaction.query.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';

/**
 * The report builder (§Phase 7): pick filters and a grouping, get a table (and chart, and summary,
 * from the same rows); save, duplicate and export it.
 *
 * Security by construction: the definition is a strict, closed schema - every filter and every
 * grouping is an item from an allow-list that this file maps to a known aggregation. No field name,
 * operator, pipeline stage or expression ever comes from the request, and the match is built by the
 * same `buildFilter` the transaction list uses, so workspace scoping, soft-deletes and other
 * members' private accounts are enforced in exactly one place.
 */

export const REPORT_GROUP_BY = ['category', 'account', 'payee', 'person', 'tag', 'month', 'day', 'type'] as const;
const MAX_ROWS = 500;
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Not a valid id.');

export const reportDefinitionSchema = z
  .object({
    range: z.enum(RANGE_PRESETS).default('last_3_months'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    types: z.array(z.enum(['income', 'expense'])).max(2).optional(),
    accountIds: z.array(objectId).max(50).optional(),
    categoryIds: z.array(objectId).max(100).optional(),
    personIds: z.array(objectId).max(100).optional(),
    payeeIds: z.array(objectId).max(100).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    minAmountMinor: z.number().int().min(0).optional(),
    maxAmountMinor: z.number().int().min(0).optional(),
    groupBy: z.enum(REPORT_GROUP_BY).default('category'),
    view: z.enum(['table', 'chart', 'summary']).default('table'),
  })
  .strict();

export function parseDefinition(raw: unknown): ReportDefinition {
  const parsed = reportDefinitionSchema.safeParse(raw);
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'That report is not valid.');
  return parsed.data as ReportDefinition;
}

function rangeOf(definition: ReportDefinition): { from: Date; to: Date } {
  if (definition.from && definition.to) return { from: new Date(definition.from), to: new Date(definition.to) };
  return resolveRange(definition.range);
}

/** The `_id` expression for each allow-listed grouping - the only place a field name is chosen. */
function groupKey(groupBy: ReportDefinition['groupBy']): unknown {
  switch (groupBy) {
    case 'category':
      return '$categoryId';
    case 'account':
      return { $arrayElemAt: ['$postings.accountId', 0] }; // income and expense rows have exactly one account leg
    case 'payee':
      return '$payeeId';
    case 'person':
      return '$personId';
    case 'tag':
      return '$tags';
    case 'month':
      return { $dateToString: { format: '%Y-%m', date: '$date' } };
    case 'day':
      return { $dateToString: { format: '%Y-%m-%d', date: '$date' } };
    case 'type':
      return '$type';
  }
}

export async function runReport(scope: RequestScope, rawDefinition: unknown): Promise<ReportResultDto> {
  const definition = parseDefinition(rawDefinition);
  const { from, to } = rangeOf(definition);
  if (from > to) throw badRequest('The start date is after the end date.');

  const filter = buildFilter(
    scope,
    {
      from,
      to,
      types: definition.types?.length ? definition.types : ['income', 'expense'],
      accountIds: definition.accountIds,
      categoryIds: definition.categoryIds,
      personIds: definition.personIds,
      payeeIds: definition.payeeIds,
      tags: definition.tags,
      minAmountMinor: definition.minAmountMinor,
      maxAmountMinor: definition.maxAmountMinor,
    },
    scope.hiddenAccountIds,
  );

  const unwind = definition.groupBy === 'tag' ? [{ $unwind: '$tags' }] : [];
  const grouped = await Transaction.aggregate<{ _id: unknown; income: number; expense: number; count: number }>([
    { $match: filter },
    ...unwind,
    {
      $group: {
        _id: groupKey(definition.groupBy),
        income: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$amountMinor', 0] } },
        expense: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amountMinor', 0] } },
        count: { $sum: 1 },
      },
    },
    { $sort: definition.groupBy === 'month' || definition.groupBy === 'day' ? { _id: 1 } : { expense: -1, income: -1 } },
    { $limit: MAX_ROWS },
  ]);

  const labels = await labelsFor(scope, definition.groupBy, grouped.map((g) => g._id));
  const rows: ReportResultRowDto[] = grouped.map((g) => {
    const key = g._id === null || g._id === undefined ? '' : String(g._id);
    return {
      key,
      label: labels.get(key) ?? defaultLabel(definition.groupBy, key),
      incomeMinor: g.income,
      expenseMinor: g.expense,
      netMinor: g.income - g.expense,
      count: g.count,
    };
  });

  // The totals are the real ones. Summing rows would be wrong for a tag grouping, where an entry is listed
  // under every tag it has, so those totals come from a second, ungrouped pass over the same match.
  const totals =
    definition.groupBy === 'tag'
      ? await ungroupedTotals(filter)
      : rows.reduce(
          (sum, r) => ({ incomeMinor: sum.incomeMinor + r.incomeMinor, expenseMinor: sum.expenseMinor + r.expenseMinor, count: sum.count + r.count }),
          { incomeMinor: 0, expenseMinor: 0, count: 0 },
        );

  return {
    definition,
    from: from.toISOString(),
    to: to.toISOString(),
    rows,
    totals: { ...totals, netMinor: totals.incomeMinor - totals.expenseMinor },
    // Grouping by tag lists a transaction under every tag it carries, so those rows overlap.
    overlapping: definition.groupBy === 'tag',
    truncated: grouped.length >= MAX_ROWS,
  };
}

async function ungroupedTotals(filter: Record<string, unknown>): Promise<{ incomeMinor: number; expenseMinor: number; count: number }> {
  const [row] = await Transaction.aggregate<{ income: number; expense: number; count: number }>([
    { $match: filter },
    {
      $group: {
        _id: null,
        income: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$amountMinor', 0] } },
        expense: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amountMinor', 0] } },
        count: { $sum: 1 },
      },
    },
  ]);
  return { incomeMinor: row?.income ?? 0, expenseMinor: row?.expense ?? 0, count: row?.count ?? 0 };
}

function defaultLabel(groupBy: ReportDefinition['groupBy'], key: string): string {
  if (!key) return groupBy === 'category' ? 'Uncategorised' : groupBy === 'payee' ? 'No payee' : groupBy === 'person' ? 'No person' : 'None';
  return key;
}

async function labelsFor(scope: RequestScope, groupBy: ReportDefinition['groupBy'], ids: unknown[]): Promise<Map<string, string>> {
  const objectIds = ids.filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);
  if (objectIds.length === 0) return new Map();
  const where = { _id: { $in: objectIds }, workspaceId: scope.workspaceId };
  const rows =
    groupBy === 'category'
      ? await Category.find(where).select('name').lean()
      : groupBy === 'account'
        ? await Account.find(where).select('name').lean()
        : groupBy === 'payee'
          ? await Payee.find(where).select('name').lean()
          : groupBy === 'person'
            ? await Person.find(where).select('name').lean()
            : [];
  return new Map(rows.map((r) => [String(r._id), (r as { name: string }).name]));
}

/** The result as CSV - free text goes through `csvText` so a name starting with `=` cannot become a formula. */
export function resultToCsv(result: ReportResultDto): string {
  return stringify(
    [
      ...result.rows.map((r) => ({
        [`${result.definition.groupBy}`]: csvText(r.label),
        Income: (r.incomeMinor / 100).toFixed(2),
        Expense: (r.expenseMinor / 100).toFixed(2),
        Net: (r.netMinor / 100).toFixed(2),
        Entries: r.count,
      })),
    ],
    { header: true },
  );
}

// ─────────────────────────────────────────────── Saved reports

const toDto = (doc: { _id: Types.ObjectId; name: string; definition: unknown; updatedAt: Date }): SavedReportDto => ({
  id: String(doc._id),
  name: doc.name,
  definition: parseDefinition(doc.definition),
  updatedAt: doc.updatedAt.toISOString(),
});

export async function listSaved(scope: RequestScope): Promise<SavedReportDto[]> {
  const docs = await SavedReport.find({ workspaceId: scope.workspaceId }).sort({ name: 1 }).lean();
  return docs.map(toDto);
}

export async function saveReport(scope: RequestScope, name: string, rawDefinition: unknown, audit: AuditContext): Promise<SavedReportDto> {
  const definition = parseDefinition(rawDefinition); // refuse anything outside the allow-list at save time, not only at run time
  const doc = await SavedReport.create({ userId: scope.userId, workspaceId: scope.workspaceId, name: name.trim(), definition });
  await recordAudit(audit, { action: 'created', entityType: 'SavedReport', entityId: doc._id, summary: `Saved report "${doc.name}"` });
  return toDto(doc);
}

async function load(scope: RequestScope, id: string) {
  if (!Types.ObjectId.isValid(id)) throw notFound('Report');
  const doc = await SavedReport.findOne({ _id: id, workspaceId: scope.workspaceId });
  if (!doc) throw notFound('Report');
  return doc;
}

export async function updateSaved(scope: RequestScope, id: string, input: { name?: string; definition?: unknown }, audit: AuditContext): Promise<SavedReportDto> {
  const doc = await load(scope, id);
  if (input.name) doc.name = input.name.trim();
  if (input.definition !== undefined) doc.definition = parseDefinition(input.definition) as unknown as Record<string, unknown>;
  await doc.save();
  await recordAudit(audit, { action: 'updated', entityType: 'SavedReport', entityId: doc._id, summary: `Updated report "${doc.name}"` });
  return toDto(doc);
}

export async function duplicateSaved(scope: RequestScope, id: string, audit: AuditContext): Promise<SavedReportDto> {
  const source = await load(scope, id);
  const copy = await SavedReport.create({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    name: `${source.name} (copy)`.slice(0, 80),
    definition: source.definition,
  });
  await recordAudit(audit, { action: 'created', entityType: 'SavedReport', entityId: copy._id, summary: `Duplicated report "${source.name}"` });
  return toDto(copy);
}

export async function deleteSaved(scope: RequestScope, id: string, audit: AuditContext): Promise<void> {
  const doc = await load(scope, id);
  await doc.deleteOne();
  await recordAudit(audit, { action: 'deleted', entityType: 'SavedReport', entityId: doc._id, summary: `Deleted report "${doc.name}"` });
}

export async function runSaved(scope: RequestScope, id: string): Promise<ReportResultDto> {
  const doc = await load(scope, id);
  return runReport(scope, doc.definition);
}
