import { parse } from 'csv-parse/sync';
import { Types } from 'mongoose';
import type {
  BankImportCommitResultDto,
  BankImportPreviewDto,
  BankImportRow,
  BankImportRowStatus,
  ImportColumnMapping,
  ImportDateFormat,
  ImportProfileDto,
} from '@khata/shared';
import { Account, ImportProfile, Transaction } from '../../models/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { parseStatementAmount, parseStatementDate } from '../../lib/bankParsing.js';
import type { RequestScope } from '../../middleware/context.js';
import { createTransaction } from '../transactions/transaction.service.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';
import { visibleAccountIds } from '../../services/accountVisibility.js';

/**
 * Bank-statement import with column mapping (docs/PRODUCT_AUDIT.md D-3,
 * Phase 5) — distinct from `modules/importexport`, which round-trips Khata's
 * *own* export format. A real bank CSV has whatever headers and date/amount
 * conventions that bank uses, which is why this takes a `mapping` instead of
 * assuming fixed column names.
 */

const DUPLICATE_WINDOW_DAYS = 3;

export function parseRawCsv(buffer: Buffer): { headers: string[]; rows: Record<string, string>[] } {
  let rows: Record<string, string>[];
  try {
    rows = parse(buffer.toString('utf-8'), { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  } catch {
    throw badRequest('That file could not be read as CSV. Check the formatting and try again.');
  }
  const headers = rows.length > 0 ? Object.keys(rows[0]!) : [];
  return { headers, rows };
}

function extractAmountMinor(record: Record<string, string>, mapping: ImportColumnMapping): number | null {
  if (mapping.amount) {
    return parseStatementAmount(record[mapping.amount] ?? '');
  }
  const debit = mapping.debit ? parseStatementAmount(record[mapping.debit] ?? '') : null;
  const credit = mapping.credit ? parseStatementAmount(record[mapping.credit] ?? '') : null;
  // A statement with separate debit/credit columns leaves the other blank for
  // every row — "0" and "blank" mean the same thing here, so both coerce to 0
  // when absent rather than making the whole row invalid.
  const debitAmount = debit ?? 0;
  const creditAmount = Math.abs(credit ?? 0);
  if (debitAmount === 0 && creditAmount === 0) return null;
  return creditAmount - Math.abs(debitAmount);
}

async function classifyRows(
  scope: RequestScope,
  accountId: string,
  dateFormat: ImportDateFormat,
  mapping: ImportColumnMapping,
  records: Record<string, string>[],
): Promise<BankImportRow[]> {
  const parsedDates = records.map((r) => parseStatementDate(r[mapping.date] ?? '', dateFormat));
  const validDates = parsedDates.filter((d): d is Date => d !== null);
  const earliest = validDates.length ? new Date(Math.min(...validDates.map((d) => d.getTime()))) : new Date();
  const latest = validDates.length ? new Date(Math.max(...validDates.map((d) => d.getTime()))) : new Date();
  const windowStart = new Date(earliest.getTime() - DUPLICATE_WINDOW_DAYS * 86_400_000);
  const windowEnd = new Date(latest.getTime() + DUPLICATE_WINDOW_DAYS * 86_400_000);

  const candidates = await Transaction.find({
    workspaceId: scope.workspaceId,
    deletedAt: null,
    'postings.accountId': accountId,
    date: { $gte: windowStart, $lte: windowEnd },
  })
    .select('date description referenceNo postings')
    .lean();

  return records.map((record, index) => {
    const rowNumber = index + 2; // header is row 1
    const errors: string[] = [];
    const date = parsedDates[index];
    if (!date) errors.push('Could not read the date with the chosen format.');

    const amountMinor = extractAmountMinor(record, mapping);
    if (amountMinor === null || amountMinor === 0) errors.push('Could not read an amount for this row.');

    const description = (record[mapping.description] ?? '').trim();
    const reference = mapping.reference ? (record[mapping.reference] ?? '').trim() || undefined : undefined;

    if (errors.length > 0 || !date || amountMinor === null) {
      return { rowNumber, raw: record, date: date?.toISOString(), description, amountMinor: amountMinor ?? undefined, reference, status: 'invalid' as BankImportRowStatus, errors };
    }

    let status: BankImportRowStatus = 'new';
    let matchedTransactionId: string | undefined;
    let matchReason: string | undefined;

    for (const candidate of candidates) {
      const posting = candidate.postings.find((p) => String(p.accountId) === accountId);
      if (!posting || posting.amountMinor !== amountMinor) continue;

      const dayGap = Math.abs(candidate.date.getTime() - date.getTime()) / 86_400_000;
      if (dayGap > DUPLICATE_WINDOW_DAYS) continue;

      if (reference && candidate.referenceNo && reference === candidate.referenceNo) {
        status = 'duplicate';
        matchedTransactionId = String(candidate._id);
        matchReason = 'Same amount and reference number.';
        break;
      }
      // No shared reference, but amount + a tight date window is still a
      // strong enough signal to flag for a human decision rather than silence.
      status = 'possible_duplicate';
      matchedTransactionId = String(candidate._id);
      matchReason = dayGap === 0 ? 'Same amount, same day.' : `Same amount, ${Math.round(dayGap)} day(s) apart.`;
    }

    return {
      rowNumber,
      raw: record,
      date: date.toISOString(),
      description,
      amountMinor,
      reference,
      status,
      matchedTransactionId,
      matchReason,
      errors: [],
    };
  });
}

export async function previewBankImport(
  scope: RequestScope,
  buffer: Buffer,
  options: { accountId: string; dateFormat: ImportDateFormat; mapping: ImportColumnMapping },
): Promise<BankImportPreviewDto> {
  if (!Types.ObjectId.isValid(options.accountId)) throw notFound('Account');
  const account = await Account.findOne({ _id: visibleAccountIds(scope, options.accountId), workspaceId: scope.workspaceId, deletedAt: null }).lean();
  if (!account) throw notFound('Account');
  if (account.visibility === 'private' && String(account.userId) !== String(scope.userId)) {
    throw notFound('Account');
  }

  const { rows: records } = parseRawCsv(buffer);
  const rows = await classifyRows(scope, options.accountId, options.dateFormat, options.mapping, records);

  const counts: Record<BankImportRowStatus, number> = { new: 0, duplicate: 0, possible_duplicate: 0, invalid: 0 };
  for (const row of rows) counts[row.status]++;

  return { rows, counts };
}

export interface CommitSelection {
  /** Row numbers to post as new transactions. */
  importRowNumbers: number[];
  /** Row numbers to mark as already recorded — sets `reconciledAt`/`statementRef` on the matched transaction instead of creating a new one. */
  matchRowNumbers: number[];
}

export async function commitBankImport(
  scope: RequestScope,
  buffer: Buffer,
  options: { accountId: string; dateFormat: ImportDateFormat; mapping: ImportColumnMapping },
  selection: CommitSelection,
  audit: AuditContext,
): Promise<BankImportCommitResultDto> {
  const preview = await previewBankImport(scope, buffer, options);
  const byRowNumber = new Map(preview.rows.map((r) => [r.rowNumber, r]));
  const importBatchId = new Types.ObjectId().toString();

  let imported = 0;
  let matched = 0;
  let skipped = 0;

  for (const rowNumber of selection.importRowNumbers) {
    const row = byRowNumber.get(rowNumber);
    if (!row || row.status === 'invalid' || !row.date || row.amountMinor === undefined) {
      skipped++;
      continue;
    }
    await createTransaction(
      scope,
      {
        type: row.amountMinor >= 0 ? 'income' : 'expense',
        amountMinor: Math.abs(row.amountMinor),
        date: new Date(row.date),
        accountId: options.accountId,
        description: row.description || 'Imported transaction',
        referenceNo: row.reference,
        importBatchId,
        statementRef: row.reference,
      },
      audit,
    );
    imported++;
  }

  for (const rowNumber of selection.matchRowNumbers) {
    const row = byRowNumber.get(rowNumber);
    if (!row || !row.matchedTransactionId) {
      skipped++;
      continue;
    }
    await Transaction.updateOne(
      { _id: row.matchedTransactionId, workspaceId: scope.workspaceId },
      { $set: { reconciledAt: new Date(), statementRef: row.reference ?? null } },
    );
    matched++;
  }

  await recordAudit(audit, {
    action: 'imported',
    entityType: 'Transaction',
    entityId: importBatchId,
    summary: `Bank import: ${imported} new, ${matched} matched to existing entries, ${skipped} skipped`,
  });

  return { imported, matched, skipped, importBatchId };
}

// ─────────────────────────────────────────────── Import profiles

export function toImportProfileDto(profile: {
  _id: Types.ObjectId;
  name: string;
  dateFormat: ImportDateFormat;
  mapping: ImportColumnMapping;
  defaultAccountId?: Types.ObjectId | null;
  createdAt: Date;
}): ImportProfileDto {
  return {
    id: String(profile._id),
    name: profile.name,
    dateFormat: profile.dateFormat,
    mapping: profile.mapping,
    defaultAccountId: profile.defaultAccountId ? String(profile.defaultAccountId) : undefined,
    createdAt: profile.createdAt.toISOString(),
  };
}

export async function listImportProfiles(scope: RequestScope): Promise<ImportProfileDto[]> {
  const profiles = await ImportProfile.find({ workspaceId: scope.workspaceId }).sort({ name: 1 }).lean();
  return profiles.map(toImportProfileDto);
}

export async function createImportProfile(
  scope: RequestScope,
  input: { name: string; dateFormat: ImportDateFormat; mapping: ImportColumnMapping; defaultAccountId?: string | null },
): Promise<ImportProfileDto> {
  try {
    const profile = await ImportProfile.create({
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      name: input.name.trim(),
      dateFormat: input.dateFormat,
      mapping: input.mapping,
      defaultAccountId: input.defaultAccountId,
    });
    return toImportProfileDto(profile);
  } catch (err) {
    if (err instanceof Error && (err as { code?: number }).code === 11000) {
      throw conflict(`You already have an import profile named "${input.name}".`, 'DUPLICATE_IMPORT_PROFILE');
    }
    throw err;
  }
}

export async function deleteImportProfile(scope: RequestScope, profileId: string): Promise<void> {
  if (!Types.ObjectId.isValid(profileId)) throw notFound('Import profile');
  const result = await ImportProfile.deleteOne({ _id: profileId, workspaceId: scope.workspaceId });
  if (result.deletedCount === 0) throw notFound('Import profile');
}
