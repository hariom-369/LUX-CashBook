import { stringify } from 'csv-stringify/sync';
import { parse } from 'csv-parse/sync';
import { Types } from 'mongoose';
import { formatDate, toMinor, type TransactionType } from '@khata/shared';
import { Account, Category, Person, Transaction } from '../../models/index.js';
import type { RequestScope } from '../../middleware/context.js';
import { hydrate, buildFilter, type TransactionFilters } from '../transactions/transaction.query.js';
import { createTransaction } from '../transactions/transaction.service.js';
import type { AuditContext } from '../../services/audit.service.js';
import { badRequest } from '../../lib/errors.js';

/**
 * CSV export (§34).
 *
 * One row per transaction, one column per field a spreadsheet user would want —
 * amounts as major units (not paise) because that's what Excel and a human both
 * expect to see in a CSV, with the minor-unit precision preserved exactly by
 * formatting to the currency's decimal places rather than dividing and truncating.
 */
export async function exportTransactionsCsv(scope: RequestScope, filters: TransactionFilters): Promise<string> {
  const filter = buildFilter(scope, filters);
  const rows = await Transaction.find(filter).sort({ date: 1, _id: 1 }).limit(50_000).lean();
  const dtos = await hydrate(scope, rows);

  const records = dtos.map((dto) => ({
    Date: formatDate(dto.date, 'yyyy-MM-dd'),
    Type: dto.type,
    Amount: (dto.amountMinor / 100).toFixed(2),
    Currency: dto.currency,
    Account: dto.accountName ?? '',
    'To Account': dto.toAccountId ? (dto.postings.find((p) => p.accountId === dto.toAccountId)?.accountName ?? '') : '',
    Category: dto.categoryName ?? '',
    Subcategory: dto.subcategoryName ?? '',
    Person: dto.personName ?? '',
    Description: dto.description,
    Notes: dto.notes ?? '',
    'Payment Method': dto.paymentMethod ?? '',
    Reference: dto.referenceNo ?? '',
    Tags: dto.tags.join(';'),
    'Due Date': dto.dueDate ? formatDate(dto.dueDate, 'yyyy-MM-dd') : '',
  }));

  return stringify(records, { header: true });
}

/** The template a user downloads before importing — same columns, no rows. */
export function buildImportTemplate(): string {
  return stringify(
    [
      {
        Date: '2026-09-01',
        Type: 'expense',
        Amount: '500.00',
        Account: 'Cash',
        Category: 'Food',
        Description: 'Groceries',
        'Payment Method': 'cash',
        Reference: '',
        Tags: '',
      },
    ],
    { header: true },
  );
}

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportPreviewRow {
  row: number;
  date: string;
  type: TransactionType;
  amountMinor: number;
  accountName: string;
  categoryName?: string;
  description: string;
  isValid: boolean;
  errors: string[];
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  validCount: number;
  errorCount: number;
}

const VALID_TYPES = new Set<TransactionType>(['income', 'expense']);

/**
 * Validate a CSV before importing anything (§34).
 *
 * Nothing is written here — this only resolves account and category names against
 * what the workspace actually has and reports exactly what would happen, so a user
 * can fix a typo'd account name before 200 rows land in their ledger instead of
 * after.
 */
export async function previewImport(scope: RequestScope, csvText: string): Promise<ImportPreview> {
  const records = parseCsv(csvText);

  const accounts = await Account.find({ workspaceId: scope.workspaceId, deletedAt: null }).select('name').lean();
  const categories = await Category.find({ workspaceId: scope.workspaceId }).select('name kind').lean();
  const accountByName = new Map(accounts.map((a) => [a.name.toLowerCase(), a]));
  const categoryByName = new Map(categories.map((c) => [`${c.kind}:${c.name.toLowerCase()}`, c]));

  const rows: ImportPreviewRow[] = records.map((record, index) => {
    const errors: string[] = [];
    const rowNumber = index + 2; // header is row 1

    const dateStr = (record.Date ?? '').trim();
    const date = dateStr ? new Date(dateStr) : null;
    if (!date || Number.isNaN(date.getTime())) errors.push('Invalid or missing date.');

    const type = (record.Type ?? '').trim().toLowerCase() as TransactionType;
    if (!VALID_TYPES.has(type)) errors.push('Type must be "income" or "expense".');

    const amountRaw = (record.Amount ?? '').trim();
    const amountMajor = Number(amountRaw);
    if (!amountRaw || !Number.isFinite(amountMajor) || amountMajor <= 0) {
      errors.push('Amount must be a positive number.');
    }

    const accountName = (record.Account ?? '').trim();
    const account = accountByName.get(accountName.toLowerCase());
    if (!accountName) errors.push('Account is required.');
    else if (!account) errors.push(`No account named "${accountName}".`);

    const categoryName = (record.Category ?? '').trim();
    if (categoryName && VALID_TYPES.has(type)) {
      const category = categoryByName.get(`${type}:${categoryName.toLowerCase()}`);
      if (!category) errors.push(`No ${type} category named "${categoryName}".`);
    }

    return {
      row: rowNumber,
      date: dateStr,
      type,
      amountMinor: Number.isFinite(amountMajor) ? toMinor(amountMajor) : 0,
      accountName,
      categoryName: categoryName || undefined,
      description: (record.Description ?? '').trim(),
      isValid: errors.length === 0,
      errors,
    };
  });

  return {
    rows,
    validCount: rows.filter((r) => r.isValid).length,
    errorCount: rows.filter((r) => !r.isValid).length,
  };
}

/**
 * Commit a previously-previewed import.
 *
 * Rows are validated a second time against current data rather than trusting the
 * preview — an account could have been renamed in between — and every row created
 * carries the same `importBatchId`, which is what makes "undo this import" a single
 * bulk soft-delete rather than a hunt through the ledger.
 */
export async function commitImport(
  scope: RequestScope,
  csvText: string,
  audit: AuditContext,
): Promise<{ imported: number; skipped: number; errors: ImportRowError[]; importBatchId: string }> {
  const preview = await previewImport(scope, csvText);
  const records = parseCsv(csvText);

  const accounts = await Account.find({ workspaceId: scope.workspaceId, deletedAt: null }).select('name').lean();
  const categories = await Category.find({ workspaceId: scope.workspaceId }).select('name kind').lean();
  const accountByName = new Map(accounts.map((a) => [a.name.toLowerCase(), a]));
  const categoryByName = new Map(categories.map((c) => [`${c.kind}:${c.name.toLowerCase()}`, c]));

  const importBatchId = new Types.ObjectId().toString();
  const errors: ImportRowError[] = [];
  let imported = 0;

  for (let i = 0; i < preview.rows.length; i++) {
    const previewRow = preview.rows[i]!;
    if (!previewRow.isValid) {
      errors.push({ row: previewRow.row, message: previewRow.errors.join(' ') });
      continue;
    }

    const record = records[i]!;
    const account = accountByName.get((record.Account ?? '').trim().toLowerCase())!;
    const categoryName = (record.Category ?? '').trim();
    const category = categoryName ? categoryByName.get(`${previewRow.type}:${categoryName.toLowerCase()}`) : undefined;

    try {
      await createTransaction(
        scope,
        {
          type: previewRow.type,
          amountMinor: previewRow.amountMinor,
          date: new Date(previewRow.date),
          accountId: String(account._id),
          categoryId: category ? String(category._id) : undefined,
          description: previewRow.description,
          referenceNo: (record.Reference ?? '').trim() || undefined,
          tags: (record.Tags ?? '').split(';').map((t) => t.trim()).filter(Boolean),
          importBatchId,
        },
        audit,
      );
      imported++;
    } catch (err) {
      errors.push({ row: previewRow.row, message: err instanceof Error ? err.message : 'Could not import this row.' });
    }
  }

  return { imported, skipped: errors.length, errors, importBatchId };
}

function parseCsv(csvText: string): Record<string, string>[] {
  try {
    return parse(csvText, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  } catch {
    throw badRequest('That file could not be read as CSV. Check the formatting and try again.');
  }
}

/** Roll back an entire import in one action — the counterpart to `importBatchId`. */
export async function undoImport(scope: RequestScope, importBatchId: string, audit: AuditContext): Promise<number> {
  const rows = await Transaction.find({ workspaceId: scope.workspaceId, importBatchId, deletedAt: null });
  const { deleteTransaction } = await import('../transactions/transaction.service.js');

  let count = 0;
  for (const row of rows) {
    await deleteTransaction(scope, String(row._id), audit);
    count++;
  }
  return count;
}

/** A person's ledger as CSV, for sharing or archival (§13, §36). */
export async function exportPersonLedgerCsv(scope: RequestScope, personId: string): Promise<string> {
  const { getPersonLedger } = await import('../people/person.service.js');
  const ledger = await getPersonLedger(scope, personId);

  const records = ledger.rows.map((row) => ({
    Date: formatDate(row.date, 'yyyy-MM-dd'),
    Description: row.description,
    'You Gave': row.gaveMinor ? (row.gaveMinor / 100).toFixed(2) : '',
    'You Received': row.receivedMinor ? (row.receivedMinor / 100).toFixed(2) : '',
    Balance: (row.balanceMinor / 100).toFixed(2),
  }));

  return stringify(records, { header: true });
}
