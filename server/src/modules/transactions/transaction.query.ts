import { Types, type FilterQuery } from 'mongoose';
import type { TransactionDto, TransactionListMeta, TransactionType, PostingDto } from '@khata/shared';
import { TRANSACTION_META, PRIVATE_TRANSFER_LABEL } from '@khata/shared';
import { Account, Attachment, Category, Payee, Person, Project, Transaction, type IAttachment, type ITransaction } from '../../models/index.js';
import type { RequestScope } from '../../middleware/context.js';
import { notFound } from '../../lib/errors.js';
import { isVisibleTo } from '../../services/accountVisibility.js';

/**
 * Reading transactions.
 *
 * Kept apart from `transaction.service.ts` on purpose: writes are about integrity
 * and run inside units of work, reads are about shape and speed. Mixing them is how
 * a "just one more join" creeps into a code path that should be atomic.
 */

export interface TransactionFilters {
  from?: Date;
  to?: Date;
  types?: TransactionType[];
  accountIds?: string[];
  categoryIds?: string[];
  personIds?: string[];
  payeeIds?: string[];
  projectIds?: string[];
  tags?: string[];
  minAmountMinor?: number;
  maxAmountMinor?: number;
  search?: string;
  /** Include soft-deleted rows — the trash view. */
  includeDeleted?: boolean;
  onlyDeleted?: boolean;
  hasAttachment?: boolean;
  /** Unsettled lend/borrow only. */
  outstandingOnly?: boolean;
  /** Expenses at any of these reimbursement stages. */
  reimbursement?: Array<'pending' | 'submitted' | 'approved' | 'paid'>;
}

/**
 * `hiddenAccountIds` — other members' `private` accounts (§Phase 9) — is
 * resolved once by the caller (`listTransactions` below, and
 * `importexport.service.ts`'s CSV export) rather than inside this function,
 * so building a filter stays a synchronous, side-effect-free operation.
 */
export function buildFilter(
  scope: RequestScope,
  filters: TransactionFilters,
  hiddenAccountIds: Types.ObjectId[] = [],
): FilterQuery<ITransaction> {
  const query: FilterQuery<ITransaction> = { workspaceId: scope.workspaceId };

  if (filters.onlyDeleted) query.deletedAt = { $ne: null };
  else if (!filters.includeDeleted) query.deletedAt = null;

  if (filters.from || filters.to) {
    query.date = {};
    if (filters.from) query.date.$gte = filters.from;
    if (filters.to) query.date.$lte = filters.to;
  }

  if (filters.types?.length) query.type = { $in: filters.types };

  const hiddenIdStrings = new Set(hiddenAccountIds.map(String));
  if (filters.accountIds?.length) {
    // Matches either leg of a transfer, which is what makes an account ledger
    // include contra entries without a `$or` at every call site. Any
    // explicitly requested account that happens to be someone else's private
    // one is silently dropped rather than erroring — same as it not existing.
    const requested = filters.accountIds.filter((id) => !hiddenIdStrings.has(id));
    query['postings.accountId'] = { $in: requested.map((id) => new Types.ObjectId(id)) };
  } else if (hiddenAccountIds.length > 0) {
    // At least one leg on an account this viewer may see; a transfer into a private account
    // stays in the shared account's ledger as a masked entry (see `maskForViewer`).
    query.postings = { $elemMatch: { accountId: { $nin: hiddenAccountIds } } };
  }
  if (hiddenAccountIds.length > 0 && (filters.search?.trim() || filters.tags?.length)) {
    // Searching text or tags would otherwise confirm what a masked entry says. Match only
    // entries that are wholly on visible accounts.
    query['postings.accountId'] = { $nin: hiddenAccountIds };
  }

  if (filters.categoryIds?.length) {
    const ids = filters.categoryIds.map((id) => new Types.ObjectId(id));
    query.$or = [{ categoryId: { $in: ids } }, { subcategoryId: { $in: ids } }];
  }

  if (filters.personIds?.length) {
    query.personId = { $in: filters.personIds.map((id) => new Types.ObjectId(id)) };
  }
  if (filters.payeeIds?.length) {
    query.payeeId = { $in: filters.payeeIds.map((id) => new Types.ObjectId(id)) };
  }
  if (filters.projectIds?.length) {
    query.projectId = { $in: filters.projectIds.map((id) => new Types.ObjectId(id)) };
  }

  if (filters.tags?.length) query.tags = { $in: filters.tags.map((t) => t.toLowerCase()) };

  if (filters.minAmountMinor !== undefined || filters.maxAmountMinor !== undefined) {
    query.amountMinor = {};
    if (filters.minAmountMinor !== undefined) query.amountMinor.$gte = filters.minAmountMinor;
    if (filters.maxAmountMinor !== undefined) query.amountMinor.$lte = filters.maxAmountMinor;
  }

  if (filters.hasAttachment) query['attachmentIds.0'] = { $exists: true };
  if (filters.reimbursement?.length) query['reimbursement.status'] = { $in: filters.reimbursement };

  if (filters.outstandingOnly) {
    query.type = { $in: ['lend', 'borrow'] };
    query.$expr = { $lt: ['$settledMinor', '$amountMinor'] };
  }

  if (filters.search?.trim()) {
    applySearch(query, filters.search.trim());
  }

  return query;
}

/**
 * Global search (§23).
 *
 * A search box in a finance app gets three kinds of input, and all three must work:
 * words ("Rahul", "fuel"), reference numbers, and amounts ("5000"). A text index
 * handles the first two; the third is handled by also matching the numeric value,
 * because someone typing 5000 is looking for a ₹5,000 transaction, not the word.
 */
function applySearch(query: FilterQuery<ITransaction>, search: string): void {
  const clauses: FilterQuery<ITransaction>[] = [];
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, 'i');

  clauses.push({ description: pattern }, { notes: pattern }, { referenceNo: pattern }, { tags: pattern });

  const numeric = Number(search.replace(/[,\s₹]/g, ''));
  if (Number.isFinite(numeric) && numeric > 0) {
    const minor = Math.round(numeric * 100);
    // Match both "5000" meaning ₹5,000 and a literal paise value, so the box does
    // the right thing whichever the user meant.
    clauses.push({ amountMinor: minor }, { amountMinor: Math.round(numeric) });
  }

  // Combine with any existing $or (category filter) rather than clobbering it.
  const existing = query.$or;
  if (existing) {
    query.$and = [{ $or: existing }, { $or: clauses }];
    delete query.$or;
  } else {
    query.$or = clauses;
  }
}

export type SortField = 'date' | 'amount' | 'created';

export interface ListOptions extends TransactionFilters {
  page?: number;
  limit?: number;
  sortBy?: SortField;
  sortOrder?: 'asc' | 'desc';
}

export async function listTransactions(
  scope: RequestScope,
  options: ListOptions,
): Promise<{ items: TransactionDto[]; total: number; meta: TransactionListMeta }> {
  const page = options.page ?? 1;
  const limit = Math.min(options.limit ?? 50, 200);
  const filter = buildFilter(scope, options, scope.hiddenAccountIds);

  const sortKey = { date: 'date', amount: 'amountMinor', created: 'createdAt' }[options.sortBy ?? 'date'];
  const direction = options.sortOrder === 'asc' ? 1 : -1;

  const [rows, total, totals] = await Promise.all([
    Transaction.find(filter)
      // `_id` as a tiebreaker keeps pagination stable when many rows share a date.
      .sort({ [sortKey]: direction, _id: direction })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(filter),
    aggregateTotals(filter),
  ]);

  const items = await hydrate(scope, rows);
  return { items, total, meta: totals };
}

/**
 * Income/expense totals for the current filter.
 *
 * Transfers, lending and borrowing are excluded by construction (invariants I5 and
 * I6) — the `$match` lists the types that count, rather than subtracting the ones
 * that do not, so a new transaction type cannot silently start appearing in income.
 */
async function aggregateTotals(filter: FilterQuery<ITransaction>): Promise<TransactionListMeta> {
  const incomeTypes = Object.entries(TRANSACTION_META)
    .filter(([, meta]) => meta.isIncome)
    .map(([type]) => type);
  const expenseTypes = Object.entries(TRANSACTION_META)
    .filter(([, meta]) => meta.isExpense)
    .map(([type]) => type);

  const [result] = await Transaction.aggregate<{ income: number; expense: number; count: number }>([
    { $match: filter },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        income: {
          $sum: { $cond: [{ $in: ['$type', incomeTypes] }, '$amountMinor', 0] },
        },
        expense: {
          $sum: { $cond: [{ $in: ['$type', expenseTypes] }, '$amountMinor', 0] },
        },
      },
    },
  ]);

  const income = result?.income ?? 0;
  const expense = result?.expense ?? 0;
  return { totalIncomeMinor: income, totalExpenseMinor: expense, netMinor: income - expense, count: result?.count ?? 0 };
}

/**
 * Attach account, category and person names to a page of transactions.
 *
 * Three batched lookups rather than `.populate()` per row: a 200-row page would
 * otherwise issue hundreds of queries, which is exactly the N+1 that makes a
 * transaction list crawl once someone has a year of history (§58).
 */
export async function hydrate(
  scope: RequestScope,
  rows: ITransaction[],
): Promise<TransactionDto[]> {
  if (rows.length === 0) return [];

  const accountIds = new Set<string>();
  const categoryIds = new Set<string>();
  const personIds = new Set<string>();
  const payeeIds = new Set<string>();
  const projectIds = new Set<string>();
  const hasAttachments = rows.some((row) => row.attachmentIds.length > 0);

  for (const row of rows) {
    for (const posting of row.postings) accountIds.add(String(posting.accountId));
    if (row.categoryId) categoryIds.add(String(row.categoryId));
    if (row.subcategoryId) categoryIds.add(String(row.subcategoryId));
    if (row.personId) personIds.add(String(row.personId));
    if (row.payeeId) payeeIds.add(String(row.payeeId));
    if (row.projectId) projectIds.add(String(row.projectId));
  }

  const [accounts, categories, people, payees, projects, attachments] = await Promise.all([
    accountIds.size
      ? Account.find({ _id: { $in: [...accountIds] }, workspaceId: scope.workspaceId })
          .select('name type color icon')
          .lean()
      : [],
    categoryIds.size
      ? Category.find({ _id: { $in: [...categoryIds] }, workspaceId: scope.workspaceId })
          .select('name icon color')
          .lean()
      : [],
    personIds.size
      ? Person.find({ _id: { $in: [...personIds] }, workspaceId: scope.workspaceId })
          .select('name avatarUrl')
          .lean()
      : [],
    payeeIds.size
      ? Payee.find({ _id: { $in: [...payeeIds] }, workspaceId: scope.workspaceId })
          .select('name')
          .lean()
      : [],
    projectIds.size
      ? Project.find({ _id: { $in: [...projectIds] }, workspaceId: scope.workspaceId })
          .select('name')
          .lean()
      : [],
    hasAttachments
      ? Attachment.find({
          workspaceId: scope.workspaceId,
          transactionId: { $in: rows.map((r) => r._id) },
          deletedAt: null,
        }).lean()
      : [],
  ]);

  const accountMap = new Map(accounts.map((a) => [String(a._id), a]));
  const categoryMap = new Map(categories.map((c) => [String(c._id), c]));
  const personMap = new Map(people.map((p) => [String(p._id), p]));
  const payeeMap = new Map(payees.map((p) => [String(p._id), p]));
  const projectMap = new Map(projects.map((p) => [String(p._id), p]));

  const attachmentsByTransaction = new Map<string, typeof attachments>();
  for (const attachment of attachments) {
    const key = String(attachment.transactionId);
    attachmentsByTransaction.set(key, [...(attachmentsByTransaction.get(key) ?? []), attachment]);
  }

  const hiddenSet = new Set(scope.hiddenAccountIds.map(String));
  return rows.map((row) => {
    const dto = toTransactionDto(
      row,
      accountMap,
      categoryMap,
      personMap,
      attachmentsByTransaction.get(String(row._id)) ?? [],
      payeeMap,
      projectMap,
    );
    return hiddenSet.size > 0 && row.postings.some((p) => hiddenSet.has(String(p.accountId))) ? maskForViewer(dto, hiddenSet) : dto;
  });
}

/**
 * A transaction with a leg on someone else's private account, as another member sees it: the
 * leg on a shared account (so that account's ledger still adds up) with everything that could
 * identify the private side removed - the other account, the description, notes, tags, reference,
 * receipts and any person.
 */
function maskForViewer(dto: TransactionDto, hiddenAccountIds: Set<string>): TransactionDto {
  return {
    ...dto,
    postings: dto.postings.filter((p) => !hiddenAccountIds.has(p.accountId)),
    accountId: dto.accountId && hiddenAccountIds.has(dto.accountId) ? undefined : dto.accountId,
    accountName: dto.accountId && hiddenAccountIds.has(dto.accountId) ? undefined : dto.accountName,
    fromAccountId: dto.fromAccountId && hiddenAccountIds.has(dto.fromAccountId) ? undefined : dto.fromAccountId,
    toAccountId: dto.toAccountId && hiddenAccountIds.has(dto.toAccountId) ? undefined : dto.toAccountId,
    description: PRIVATE_TRANSFER_LABEL,
    isMasked: true,
    notes: undefined,
    tags: [],
    referenceNo: undefined,
    paymentMethod: undefined,
    attachments: [],
    personId: undefined,
    personName: undefined,
    payeeId: undefined,
    payeeName: undefined,
    projectId: undefined,
    projectName: undefined,
    categoryId: undefined,
    categoryName: undefined,
    categoryIcon: undefined,
    categoryColor: undefined,
    subcategoryId: undefined,
    subcategoryName: undefined,
    recurringId: undefined,
    splitGroupId: undefined,
    groupExpenseId: undefined,
    reimbursement: undefined,
    statementRef: undefined,
  };
}

export function toTransactionDto(
  row: ITransaction,
  accountMap: Map<string, { name: string }>,
  categoryMap: Map<string, { name: string; icon: string; color: string }>,
  personMap: Map<string, { name: string }>,
  attachments: IAttachment[] = [],
  payeeMap: Map<string, { name: string }> = new Map(),
  projectMap: Map<string, { name: string }> = new Map(),
): TransactionDto {
  const meta = TRANSACTION_META[row.type];

  const postings: PostingDto[] = row.postings.map((posting) => ({
    accountId: String(posting.accountId),
    accountName: accountMap.get(String(posting.accountId))?.name,
    amountMinor: posting.amountMinor,
  }));

  // Convenience mirrors: a transfer exposes from/to, everything else a single
  // account, so the UI never has to reason about posting signs.
  const transfer = meta.isTransfer;
  const outgoing = row.postings.find((p) => p.amountMinor < 0);
  const incoming = row.postings.find((p) => p.amountMinor > 0);
  const primary = row.postings[0];

  const category = row.categoryId ? categoryMap.get(String(row.categoryId)) : undefined;
  const subcategory = row.subcategoryId ? categoryMap.get(String(row.subcategoryId)) : undefined;

  const outstandingMinor =
    row.type === 'lend' || row.type === 'borrow'
      ? Math.max(0, row.amountMinor - row.settledMinor)
      : undefined;

  return {
    id: String(row._id),
    rev: row.rev,
    workspaceId: String(row.workspaceId),
    type: row.type,
    amountMinor: row.amountMinor,
    currency: row.currency,
    date: row.date.toISOString(),
    postings,
    accountId: transfer ? undefined : primary ? String(primary.accountId) : undefined,
    accountName: transfer ? undefined : primary ? accountMap.get(String(primary.accountId))?.name : undefined,
    fromAccountId: transfer && outgoing ? String(outgoing.accountId) : undefined,
    toAccountId: transfer && incoming ? String(incoming.accountId) : undefined,
    categoryId: row.categoryId ? String(row.categoryId) : undefined,
    categoryName: category?.name,
    categoryIcon: category?.icon,
    categoryColor: category?.color,
    subcategoryId: row.subcategoryId ? String(row.subcategoryId) : undefined,
    subcategoryName: subcategory?.name,
    personId: row.personId ? String(row.personId) : undefined,
    personName: row.personId ? personMap.get(String(row.personId))?.name : undefined,
    payeeId: row.payeeId ? String(row.payeeId) : undefined,
    payeeName: row.payeeId ? payeeMap.get(String(row.payeeId))?.name : undefined,
    projectId: row.projectId ? String(row.projectId) : undefined,
    projectName: row.projectId ? projectMap.get(String(row.projectId))?.name : undefined,
    description: row.description,
    notes: row.notes,
    paymentMethod: row.paymentMethod,
    referenceNo: row.referenceNo,
    tags: row.tags,
    attachments: attachments.map((a) => ({
      id: String(a._id),
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      url: `/api/v1/attachments/${a._id}/download`,
      thumbnailUrl: a.thumbnailKey ? `/api/v1/attachments/${a._id}/thumbnail` : undefined,
      uploadedAt: a.createdAt.toISOString(),
    })),
    dueDate: row.dueDate ? row.dueDate.toISOString() : undefined,
    parentTransactionId: row.parentTransactionId ? String(row.parentTransactionId) : undefined,
    outstandingMinor,
    isSettled: outstandingMinor === undefined ? undefined : outstandingMinor === 0,
    discountMinor: row.discountMinor || undefined,
    recurringId: row.recurringId ? String(row.recurringId) : undefined,
    isRecurringInstance: row.isRecurringInstance,
    reconciledAt: row.reconciledAt ? row.reconciledAt.toISOString() : undefined,
    statementRef: row.statementRef ?? undefined,
    splitGroupId: row.splitGroupId ?? undefined,
    groupExpenseId: row.groupExpenseId ? String(row.groupExpenseId) : undefined,
    reimbursement: row.reimbursement
      ? {
          status: row.reimbursement.status,
          payoutTransactionId: row.reimbursement.payoutTransactionId ? String(row.reimbursement.payoutTransactionId) : undefined,
          updatedAt: row.reimbursement.updatedAt.toISOString(),
        }
      : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

export async function getTransaction(scope: RequestScope, transactionId: string): Promise<TransactionDto> {
  if (!Types.ObjectId.isValid(transactionId)) throw notFound('Transaction');

  const row = await Transaction.findOne({
    _id: transactionId,
    workspaceId: scope.workspaceId,
  }).lean();

  if (!row) throw notFound('Transaction');

  // Same rule as the list/export paths: a transaction touching another
  // member's private account is invisible here too, not just absent from
  // listings — otherwise a known/guessed id would leak it directly.
  // Wholly on other members' private accounts: invisible here too, not just absent from
  // listings - otherwise a known or guessed id would leak it directly. (One visible leg is
  // enough to be shown, masked, by `hydrate`.)
  if (!isVisibleTo(row.postings, scope.hiddenAccountIds)) {
    throw notFound('Transaction');
  }

  const [dto] = await hydrate(scope, [row]);
  return dto!;
}
