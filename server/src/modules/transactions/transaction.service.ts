import { Types, type HydratedDocument } from 'mongoose';
import {
  TRANSACTION_META,
  formatMoney,
  type PaymentMethod,
  type TransactionType,
} from '@khata/shared';
import {
  Account,
  Category,
  MonthClosing,
  Person,
  Transaction,
  type IPosting,
  type ITransaction,
} from '../../models/index.js';
import {
  badRequest,
  conflict,
  invalidAmount,
  notFound,
  overRepayment,
  periodClosed,
} from '../../lib/errors.js';
import { withTransaction, type UnitOfWork } from '../../lib/transaction.js';
import type { RequestScope } from '../../middleware/context.js';
import {
  applyBalanceDeltas,
  applyPersonDelta,
  assertSufficientBalance,
  type BalanceDelta,
} from '../../services/balance.service.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';

export type TransactionDoc = HydratedDocument<ITransaction>;

export interface CreateTransactionInput {
  type: TransactionType;
  amountMinor: number;
  date: Date;
  /** The account money moves on. For a transfer, the source. */
  accountId: string;
  /** Transfers only: the destination. */
  toAccountId?: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  personId?: string | null;
  description?: string;
  notes?: string;
  paymentMethod?: PaymentMethod;
  referenceNo?: string;
  tags?: string[];
  attachmentIds?: string[];
  dueDate?: Date | null;
  /** Repayments: the specific loan being paid down. Omitted = oldest first. */
  parentTransactionId?: string | null;
  /** Cash book triple column. */
  discountMinor?: number;
  /** `adjustment` only — every other type's direction is implied by its type. */
  direction?: 'in' | 'out';
  idempotencyKey?: string;
  importBatchId?: string;
  recurringId?: string;
  isSettlement?: boolean;
}

/**
 * Turn a request into postings (invariant I3).
 *
 * This is the single place where a transaction type becomes actual money movement.
 * Everything downstream — balances, the cash book, reports, net worth — reads the
 * postings, so getting the mapping right here is what makes every one of those
 * correct by construction rather than by repeated care.
 */
function derivePostings(
  type: TransactionType,
  amountMinor: number,
  accountId: Types.ObjectId,
  toAccountId: Types.ObjectId | undefined,
  direction: 'in' | 'out' | undefined,
): { postings: IPosting[]; personDeltaMinor: number } {
  const meta = TRANSACTION_META[type];

  if (meta.isTransfer) {
    if (!toAccountId) throw badRequest('Choose the account the money is going to.');
    if (String(accountId) === String(toAccountId)) {
      throw badRequest('Choose two different accounts for a transfer.');
    }
    // The two legs cancel exactly, so a transfer cannot change total net cash (I5).
    return {
      postings: [
        { accountId, amountMinor: -amountMinor },
        { accountId: toAccountId, amountMinor: amountMinor },
      ],
      personDeltaMinor: 0,
    };
  }

  let signed: number;
  if (meta.direction === 'in') signed = amountMinor;
  else if (meta.direction === 'out') signed = -amountMinor;
  else {
    // `adjustment` is the only type whose direction the caller must state.
    if (!direction) throw badRequest('Say whether this adjustment increases or decreases the balance.');
    signed = direction === 'in' ? amountMinor : -amountMinor;
  }

  // Money leaving your pocket towards a person increases what they owe you; money
  // arriving from them decreases it. Always the exact negation of the account leg.
  const personDeltaMinor = meta.isPersonal ? -signed : 0;

  return { postings: [{ accountId, amountMinor: signed }], personDeltaMinor };
}

/** Reject writes into a month the user has closed (§33). */
async function assertPeriodOpen(scope: RequestScope, date: Date, uow?: UnitOfWork): Promise<void> {
  const closing = await MonthClosing.findOne({
    workspaceId: scope.workspaceId,
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    reopenedAt: null,
  })
    .session(uow?.session ?? null)
    .lean();

  if (closing) {
    const label = date.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
    throw periodClosed(label);
  }
}

async function resolveAccount(
  scope: RequestScope,
  accountId: string | Types.ObjectId,
  uow?: UnitOfWork,
) {
  if (!Types.ObjectId.isValid(accountId)) throw notFound('Account');
  const account = await Account.findOne({
    _id: accountId,
    workspaceId: scope.workspaceId,
    deletedAt: null,
  })
    .session(uow?.session ?? null)
    .lean();
  if (!account) throw notFound('Account');
  return account;
}

async function assertCategoryBelongs(
  scope: RequestScope,
  categoryId: string | null | undefined,
  expectKind: 'income' | 'expense',
  uow?: UnitOfWork,
): Promise<Types.ObjectId | null> {
  if (!categoryId) return null;
  if (!Types.ObjectId.isValid(categoryId)) throw notFound('Category');

  const category = await Category.findOne({ _id: categoryId, workspaceId: scope.workspaceId })
    .session(uow?.session ?? null)
    .lean();
  if (!category) throw notFound('Category');
  if (category.kind !== expectKind) {
    throw badRequest(`"${category.name}" is an ${category.kind} category.`);
  }
  return category._id;
}

async function assertPersonBelongs(
  scope: RequestScope,
  personId: string | null | undefined,
  uow?: UnitOfWork,
): Promise<Types.ObjectId | null> {
  if (!personId) return null;
  if (!Types.ObjectId.isValid(personId)) throw notFound('Person');

  const person = await Person.findOne({
    _id: personId,
    workspaceId: scope.workspaceId,
    deletedAt: null,
  })
    .session(uow?.session ?? null)
    .lean();
  if (!person) throw notFound('Person');
  return person._id;
}

// ─────────────────────────────────────────────── Create

export async function createTransaction(
  scope: RequestScope,
  input: CreateTransactionInput,
  audit: AuditContext,
): Promise<TransactionDoc> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw invalidAmount();
  }

  const meta = TRANSACTION_META[input.type];
  if (!meta) throw badRequest('That transaction type is not recognised.');

  // A retried POST with the same key returns the original row rather than a second
  // one — the answer to double-submission (§69).
  if (input.idempotencyKey) {
    const existing = await Transaction.findOne({
      workspaceId: scope.workspaceId,
      idempotencyKey: input.idempotencyKey,
    });
    if (existing) return existing;
  }

  return withTransaction(async (uow) => {
    await assertPeriodOpen(scope, input.date, uow);

    const account = await resolveAccount(scope, input.accountId, uow);
    const toAccount = input.toAccountId ? await resolveAccount(scope, input.toAccountId, uow) : undefined;

    if (toAccount && toAccount.currency !== account.currency) {
      throw badRequest(
        'Transfers between accounts in different currencies are not supported yet. Record them as an expense and an income instead.',
      );
    }

    const { postings, personDeltaMinor } = derivePostings(
      input.type,
      input.amountMinor,
      account._id,
      toAccount?._id,
      input.direction,
    );

    // Lending and borrowing are never income or expense (invariant I6), so they
    // carry no category at all.
    const categoryId = meta.isPersonal
      ? null
      : await assertCategoryBelongs(
          scope,
          input.categoryId,
          meta.isIncome ? 'income' : 'expense',
          uow,
        );

    const personId = await assertPersonBelongs(scope, input.personId, uow);
    if (meta.isPersonal && !personId) {
      throw badRequest(`Choose who this ${meta.label.toLowerCase()} involves.`);
    }

    const deltas: BalanceDelta[] = postings.map((p) => ({
      accountId: p.accountId,
      amountMinor: p.amountMinor,
    }));
    await assertSufficientBalance(scope.workspaceId, deltas, uow);

    // Repayments consume outstanding loan balance before anything is written, so an
    // over-repayment is rejected rather than half-applied.
    let parentTransactionId: Types.ObjectId | null = null;
    let allocations: Array<{ id: Types.ObjectId; amountMinor: number }> = [];

    if (input.type === 'repayment_given' || input.type === 'repayment_received') {
      allocations = await allocateRepayment(
        scope,
        input.type,
        personId!,
        input.amountMinor,
        input.parentTransactionId ?? null,
        uow,
      );
      parentTransactionId = allocations[0]?.id ?? null;
    }

    const [created] = await Transaction.create(
      [
        {
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          type: input.type,
          amountMinor: input.amountMinor,
          currency: account.currency,
          date: input.date,
          postings,
          categoryId,
          subcategoryId: input.subcategoryId ?? null,
          personId,
          personDeltaMinor,
          description: input.description?.trim() ?? '',
          notes: input.notes,
          paymentMethod: input.paymentMethod ?? defaultPaymentMethod(account.type),
          referenceNo: input.referenceNo,
          tags: input.tags ?? [],
          attachmentIds: input.attachmentIds?.map((id) => new Types.ObjectId(id)) ?? [],
          dueDate: input.type === 'lend' || input.type === 'borrow' ? (input.dueDate ?? null) : null,
          parentTransactionId,
          discountMinor: input.discountMinor ?? 0,
          isSettlement: input.isSettlement ?? false,
          recurringId: input.recurringId ?? null,
          isRecurringInstance: Boolean(input.recurringId),
          importBatchId: input.importBatchId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      ],
      { session: uow.session, ordered: true },
    );

    const transaction = created!;

    uow.onRollback(async () => {
      await Transaction.deleteOne({ _id: transaction._id });
      for (const allocation of allocations) {
        await Transaction.updateOne(
          { _id: allocation.id },
          { $inc: { settledMinor: -allocation.amountMinor }, $set: { settledAt: null } },
        );
      }
    });

    await applyBalanceDeltas(scope.workspaceId, deltas, uow);
    if (personId && personDeltaMinor !== 0) {
      await applyPersonDelta(scope.workspaceId, personId, personDeltaMinor, input.date, uow);
    }

    await recordAudit(audit, {
      action: 'created',
      entityType: 'Transaction',
      entityId: transaction._id,
      summary: summarise(transaction, account.name),
    });

    return transaction;
  });
}

/**
 * Consume outstanding loan balance for a repayment.
 *
 * The `$expr` guard in the update filter is the important part: it makes
 * "increment settled, but only if that keeps it at or below the original amount"
 * a single atomic operation. Two repayments racing for the last ₹1,000 of a loan
 * cannot both succeed, so a loan can never be over-repaid (§51) — and that holds
 * whether or not the deployment supports multi-document transactions.
 */
async function allocateRepayment(
  scope: RequestScope,
  type: 'repayment_given' | 'repayment_received',
  personId: Types.ObjectId,
  amountMinor: number,
  explicitParentId: string | null,
  uow: UnitOfWork,
): Promise<Array<{ id: Types.ObjectId; amountMinor: number }>> {
  // Repaying money you borrowed pays down `borrow` rows; collecting money you lent
  // pays down `lend` rows.
  const parentType = type === 'repayment_given' ? 'borrow' : 'lend';

  const filter: Record<string, unknown> = {
    workspaceId: scope.workspaceId,
    personId,
    type: parentType,
    deletedAt: null,
    $expr: { $lt: ['$settledMinor', '$amountMinor'] },
  };
  if (explicitParentId) {
    if (!Types.ObjectId.isValid(explicitParentId)) throw notFound('Loan');
    filter._id = new Types.ObjectId(explicitParentId);
  }

  const open = await Transaction.find(filter)
    .sort({ date: 1, _id: 1 }) // Oldest debt first.
    .session(uow.session ?? null);

  const totalOutstanding = open.reduce(
    (sum, loan) => sum + Math.max(0, loan.amountMinor - loan.settledMinor),
    0,
  );

  if (open.length === 0) {
    throw conflict(
      'There is no outstanding amount to repay for this person.',
      'NOTHING_OUTSTANDING',
    );
  }

  if (amountMinor > totalOutstanding) {
    throw overRepayment(formatMoney(totalOutstanding, { currency: scope.currency }));
  }

  const allocations: Array<{ id: Types.ObjectId; amountMinor: number }> = [];
  let remaining = amountMinor;

  for (const loan of open) {
    if (remaining <= 0) break;
    const outstanding = Math.max(0, loan.amountMinor - loan.settledMinor);
    const applied = Math.min(outstanding, remaining);
    if (applied <= 0) continue;

    const result = await Transaction.updateOne(
      {
        _id: loan._id,
        workspaceId: scope.workspaceId,
        deletedAt: null,
        // Atomic guard: only increment if it stays within the original amount.
        $expr: { $lte: [{ $add: ['$settledMinor', applied] }, '$amountMinor'] },
      },
      [
        { $set: { settledMinor: { $add: ['$settledMinor', applied] } } },
        {
          $set: {
            settledAt: {
              $cond: [{ $gte: ['$settledMinor', '$amountMinor'] }, new Date(), null],
            },
          },
        },
      ],
      { session: uow.session },
    );

    if (result.matchedCount === 0) {
      // Someone else consumed this loan between our read and our write.
      throw conflict(
        'That repayment was already recorded. Refresh and check the outstanding amount.',
        'REPAYMENT_RACE',
      );
    }

    allocations.push({ id: loan._id, amountMinor: applied });
    remaining -= applied;
  }

  if (remaining > 0) {
    throw overRepayment(formatMoney(totalOutstanding, { currency: scope.currency }));
  }

  return allocations;
}

function defaultPaymentMethod(accountType: string): PaymentMethod {
  switch (accountType) {
    case 'cash':
      return 'cash';
    case 'upi':
      return 'upi';
    case 'credit_card':
      return 'card';
    case 'bank':
    case 'savings':
      return 'net_banking';
    default:
      return 'other';
  }
}

function summarise(transaction: ITransaction, accountName: string): string {
  const meta = TRANSACTION_META[transaction.type];
  const amount = formatMoney(transaction.amountMinor, { currency: transaction.currency });
  const description = transaction.description ? ` · ${transaction.description}` : '';
  return `${meta.label} ${amount} on ${accountName}${description}`.slice(0, 300);
}

// ─────────────────────────────────────────────── Delete & restore

/**
 * Soft-delete a transaction (invariant I7).
 *
 * The row stays; only `deletedAt` is set. That is what makes UNDO (§43) a one-field
 * write rather than a re-creation, keeps the audit trail coherent, and means a
 * mis-tap can never destroy financial history.
 */
export async function deleteTransaction(
  scope: RequestScope,
  transactionId: string,
  audit: AuditContext,
): Promise<TransactionDoc> {
  return withTransaction(async (uow) => {
    const transaction = await Transaction.findOne({
      _id: transactionId,
      workspaceId: scope.workspaceId,
      deletedAt: null,
    }).session(uow.session ?? null);

    if (!transaction) throw notFound('Transaction');
    await assertPeriodOpen(scope, transaction.date, uow);

    // A loan that has been partly repaid cannot be removed without orphaning the
    // repayments that point at it.
    if ((transaction.type === 'lend' || transaction.type === 'borrow') && transaction.settledMinor > 0) {
      throw conflict(
        'Delete the repayments recorded against this first.',
        'HAS_REPAYMENTS',
      );
    }

    transaction.deletedAt = new Date();
    transaction.deletedBy = scope.userId;
    await transaction.save({ session: uow.session });

    uow.onRollback(async () => {
      await Transaction.updateOne(
        { _id: transaction._id },
        { $set: { deletedAt: null, deletedBy: null } },
      );
    });

    // Reverse the money it moved.
    await applyBalanceDeltas(
      scope.workspaceId,
      transaction.postings.map((p) => ({ accountId: p.accountId, amountMinor: -p.amountMinor })),
      uow,
    );

    if (transaction.personId && transaction.personDeltaMinor !== 0) {
      await applyPersonDelta(
        scope.workspaceId,
        transaction.personId,
        -transaction.personDeltaMinor,
        transaction.date,
        uow,
      );
    }

    // Give back the loan capacity a repayment had consumed.
    await releaseRepaymentAllocation(scope, transaction, uow);

    await recordAudit(audit, {
      action: 'deleted',
      entityType: 'Transaction',
      entityId: transaction._id,
      summary: `Deleted ${TRANSACTION_META[transaction.type].label.toLowerCase()} ${formatMoney(transaction.amountMinor, { currency: transaction.currency })}`,
      before: { deletedAt: null },
      after: { deletedAt: transaction.deletedAt },
    });

    return transaction;
  });
}

export async function restoreTransaction(
  scope: RequestScope,
  transactionId: string,
  audit: AuditContext,
): Promise<TransactionDoc> {
  return withTransaction(async (uow) => {
    const transaction = await Transaction.findOne({
      _id: transactionId,
      workspaceId: scope.workspaceId,
      deletedAt: { $ne: null },
    }).session(uow.session ?? null);

    if (!transaction) throw notFound('Transaction');
    await assertPeriodOpen(scope, transaction.date, uow);

    const deltas = transaction.postings.map((p) => ({
      accountId: p.accountId,
      amountMinor: p.amountMinor,
    }));
    await assertSufficientBalance(scope.workspaceId, deltas, uow);

    // Restoring a repayment has to re-consume loan capacity, which may no longer be
    // available if the loan was settled some other way in the meantime.
    if (transaction.type === 'repayment_given' || transaction.type === 'repayment_received') {
      await allocateRepayment(
        scope,
        transaction.type,
        transaction.personId!,
        transaction.amountMinor,
        transaction.parentTransactionId ? String(transaction.parentTransactionId) : null,
        uow,
      );
    }

    transaction.deletedAt = null;
    transaction.deletedBy = null;
    await transaction.save({ session: uow.session });

    await applyBalanceDeltas(scope.workspaceId, deltas, uow);
    if (transaction.personId && transaction.personDeltaMinor !== 0) {
      await applyPersonDelta(
        scope.workspaceId,
        transaction.personId,
        transaction.personDeltaMinor,
        transaction.date,
        uow,
      );
    }

    await recordAudit(audit, {
      action: 'restored',
      entityType: 'Transaction',
      entityId: transaction._id,
      summary: `Restored ${TRANSACTION_META[transaction.type].label.toLowerCase()} ${formatMoney(transaction.amountMinor, { currency: transaction.currency })}`,
    });

    return transaction;
  });
}

/** Return the outstanding capacity a deleted repayment had consumed. */
async function releaseRepaymentAllocation(
  scope: RequestScope,
  transaction: ITransaction,
  uow: UnitOfWork,
): Promise<void> {
  if (transaction.type !== 'repayment_given' && transaction.type !== 'repayment_received') return;
  if (!transaction.parentTransactionId) return;

  await Transaction.updateOne(
    { _id: transaction.parentTransactionId, workspaceId: scope.workspaceId },
    [
      {
        $set: {
          settledMinor: {
            $max: [0, { $subtract: ['$settledMinor', transaction.amountMinor] }],
          },
        },
      },
      {
        $set: {
          settledAt: { $cond: [{ $gte: ['$settledMinor', '$amountMinor'] }, '$settledAt', null] },
        },
      },
    ],
    { session: uow.session },
  );
}

// ─────────────────────────────────────────────── Update

export interface UpdateTransactionInput {
  amountMinor?: number;
  date?: Date;
  accountId?: string;
  toAccountId?: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  description?: string;
  notes?: string;
  paymentMethod?: PaymentMethod;
  referenceNo?: string;
  tags?: string[];
  dueDate?: Date | null;
  discountMinor?: number;
}

/**
 * Edit a transaction.
 *
 * Financial fields (amount, accounts, date) are handled by reversing the old
 * postings and applying the new ones inside one unit of work, rather than by
 * patching balances in place. Reversal-then-reapply is the only approach that is
 * obviously correct for every combination of changes — and an edit that leaves a
 * balance half-adjusted is precisely what §72 forbids.
 *
 * The type is deliberately immutable: an expense that becomes a transfer is a
 * different transaction, and pretending otherwise makes the audit trail lie.
 */
export async function updateTransaction(
  scope: RequestScope,
  transactionId: string,
  input: UpdateTransactionInput,
  audit: AuditContext,
): Promise<TransactionDoc> {
  return withTransaction(async (uow) => {
    const transaction = await Transaction.findOne({
      _id: transactionId,
      workspaceId: scope.workspaceId,
      deletedAt: null,
    }).session(uow.session ?? null);

    if (!transaction) throw notFound('Transaction');

    const meta = TRANSACTION_META[transaction.type];
    await assertPeriodOpen(scope, transaction.date, uow);
    if (input.date) await assertPeriodOpen(scope, input.date, uow);

    if (input.amountMinor !== undefined && (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)) {
      throw invalidAmount();
    }

    // Changing a partly-repaid loan's amount could make it repaid beyond its value.
    if (
      (transaction.type === 'lend' || transaction.type === 'borrow') &&
      input.amountMinor !== undefined &&
      input.amountMinor < transaction.settledMinor
    ) {
      throw conflict(
        `Repayments of ${formatMoney(transaction.settledMinor, { currency: transaction.currency })} have already been recorded against this.`,
        'AMOUNT_BELOW_SETTLED',
      );
    }

    const before = {
      amountMinor: transaction.amountMinor,
      date: transaction.date,
      description: transaction.description,
      accountId: String(transaction.postings[0]?.accountId ?? ''),
    };

    const oldDeltas = transaction.postings.map((p) => ({
      accountId: p.accountId,
      amountMinor: -p.amountMinor,
    }));
    const oldPersonDelta = -transaction.personDeltaMinor;

    const nextAmount = input.amountMinor ?? transaction.amountMinor;
    const sourceAccountId = input.accountId ?? String(transaction.postings[0]!.accountId);
    const account = await resolveAccount(scope, sourceAccountId, uow);

    const nextToAccountId =
      input.toAccountId ??
      (meta.isTransfer ? String(transaction.postings[1]?.accountId ?? '') : undefined);
    const toAccount =
      meta.isTransfer && nextToAccountId ? await resolveAccount(scope, nextToAccountId, uow) : undefined;

    const { postings, personDeltaMinor } = derivePostings(
      transaction.type,
      nextAmount,
      account._id,
      toAccount?._id,
      transaction.postings[0]!.amountMinor > 0 ? 'in' : 'out',
    );

    if (input.categoryId !== undefined && !meta.isPersonal) {
      transaction.categoryId = await assertCategoryBelongs(
        scope,
        input.categoryId,
        meta.isIncome ? 'income' : 'expense',
        uow,
      );
    }
    if (input.subcategoryId !== undefined) {
      transaction.subcategoryId = input.subcategoryId ? new Types.ObjectId(input.subcategoryId) : null;
    }

    transaction.amountMinor = nextAmount;
    transaction.postings = postings;
    transaction.personDeltaMinor = personDeltaMinor;
    transaction.currency = account.currency;
    if (input.date) transaction.date = input.date;
    if (input.description !== undefined) transaction.description = input.description.trim();
    if (input.notes !== undefined) transaction.notes = input.notes;
    if (input.paymentMethod !== undefined) transaction.paymentMethod = input.paymentMethod;
    if (input.referenceNo !== undefined) transaction.referenceNo = input.referenceNo;
    if (input.tags !== undefined) transaction.tags = input.tags;
    if (input.discountMinor !== undefined) transaction.discountMinor = input.discountMinor;
    if (input.dueDate !== undefined && (transaction.type === 'lend' || transaction.type === 'borrow')) {
      transaction.dueDate = input.dueDate;
    }

    const newDeltas = postings.map((p) => ({ accountId: p.accountId, amountMinor: p.amountMinor }));
    await assertSufficientBalance(scope.workspaceId, [...oldDeltas, ...newDeltas], uow);

    await transaction.save({ session: uow.session });

    // Reverse the old effect, then apply the new one.
    await applyBalanceDeltas(scope.workspaceId, [...oldDeltas, ...newDeltas], uow);
    if (transaction.personId) {
      const net = oldPersonDelta + personDeltaMinor;
      if (net !== 0) {
        await applyPersonDelta(scope.workspaceId, transaction.personId, net, transaction.date, uow);
      }
    }

    await recordAudit(audit, {
      action: 'updated',
      entityType: 'Transaction',
      entityId: transaction._id,
      summary: `Edited ${meta.label.toLowerCase()} ${formatMoney(transaction.amountMinor, { currency: transaction.currency })}`,
      before,
      after: {
        amountMinor: transaction.amountMinor,
        date: transaction.date,
        description: transaction.description,
        accountId: String(account._id),
      },
    });

    return transaction;
  });
}
