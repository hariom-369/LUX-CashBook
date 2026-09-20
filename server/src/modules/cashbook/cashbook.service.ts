import { Types } from 'mongoose';
import type { CashBookDto, CashBookRowDto } from '@khata/shared';
import { Account, Transaction } from '../../models/index.js';
import type { RequestScope } from '../../middleware/context.js';
import { hydrate } from '../transactions/transaction.query.js';

/**
 * The traditional cash book (§10).
 *
 * This is the view an accountant or a shopkeeper recognises — receipts on one side,
 * payments on the other, a running balance down the right. It is built entirely from
 * the same postings everything else reads, so it cannot disagree with the dashboard:
 * there is no separate "cash book ledger" to fall out of sync.
 *
 * Three presentations over the same data:
 *
 *   single  — one column pair. Every account, or a chosen subset.
 *   double  — Cash and Bank side by side. A cash-to-bank transfer appears in both
 *             columns as a contra entry (§11), never as income or expense.
 *   triple  — adds discount allowed and discount received.
 */
export type CashBookView = 'single' | 'double' | 'triple';

export interface CashBookOptions {
  view: CashBookView;
  from: Date;
  to: Date;
  /** Restrict to specific accounts. Empty = every cash/bank account. */
  accountIds?: string[];
}

interface AccountClass {
  id: string;
  name: string;
  /** Which column this account belongs to in double/triple view. */
  column: 'cash' | 'bank';
}

/**
 * Decide which column an account belongs to.
 *
 * `cash` is literal cash in hand; everything with a balance held elsewhere — bank,
 * UPI, wallet, savings — is "bank" for cash-book purposes, because that is the
 * distinction the format is actually about: money in the drawer versus money at an
 * institution.
 */
function classify(type: string): 'cash' | 'bank' {
  return type === 'cash' ? 'cash' : 'bank';
}

export async function getCashBook(scope: RequestScope, options: CashBookOptions): Promise<CashBookDto> {
  const accountFilter: Record<string, unknown> = {
    workspaceId: scope.workspaceId,
    deletedAt: null,
  };
  if (options.accountIds?.length) {
    accountFilter._id = { $in: options.accountIds.map((id) => new Types.ObjectId(id)) };
  } else {
    // Default scope: the accounts a cash book is actually about. Credit cards and
    // investments are not part of a receipts-and-payments statement.
    accountFilter.type = { $in: ['cash', 'bank', 'upi', 'wallet', 'savings'] };
  }

  const accounts = await Account.find(accountFilter).select('name type').lean();
  const classes = new Map<string, AccountClass>(
    accounts.map((account) => [
      String(account._id),
      { id: String(account._id), name: account.name, column: classify(account.type) },
    ]),
  );
  const accountIds = accounts.map((account) => account._id);

  if (accountIds.length === 0) {
    return emptyCashBook(options);
  }

  // Opening balance: account openings plus everything posted before the window.
  const openingAccounts = await Account.find({ _id: { $in: accountIds } })
    .select('openingBalanceMinor type openingDate')
    .lean();

  // Everything posted before the window, per account, folded into the two columns.
  const priorByAccount = await Transaction.aggregate<{ _id: Types.ObjectId; total: number }>([
    {
      $match: {
        workspaceId: scope.workspaceId,
        deletedAt: null,
        date: { $lt: options.from },
        'postings.accountId': { $in: accountIds },
      },
    },
    { $unwind: '$postings' },
    { $match: { 'postings.accountId': { $in: accountIds } } },
    { $group: { _id: '$postings.accountId', total: { $sum: '$postings.amountMinor' } } },
  ]);

  let openingCash = 0;
  let openingBank = 0;

  for (const row of priorByAccount) {
    const klass = classes.get(String(row._id));
    if (!klass) continue;
    if (klass.column === 'cash') openingCash += row.total;
    else openingBank += row.total;
  }

  for (const account of openingAccounts) {
    // An opening balance only counts once the account exists; an account opened
    // mid-window contributes to the movement, not to the opening figure.
    if (account.openingDate <= options.from) {
      if (classify(account.type) === 'cash') openingCash += account.openingBalanceMinor;
      else openingBank += account.openingBalanceMinor;
    }
  }

  const transactions = await Transaction.find({
    workspaceId: scope.workspaceId,
    deletedAt: null,
    date: { $gte: options.from, $lte: options.to },
    'postings.accountId': { $in: accountIds },
  })
    .sort({ date: 1, _id: 1 })
    .lean();

  const dtos = await hydrate(scope, transactions);

  let runningCash = openingCash;
  let runningBank = openingBank;

  const totals = {
    receiptMinor: 0,
    paymentMinor: 0,
    cashReceiptMinor: 0,
    cashPaymentMinor: 0,
    bankReceiptMinor: 0,
    bankPaymentMinor: 0,
    discountAllowedMinor: 0,
    discountReceivedMinor: 0,
  };

  const rows: CashBookRowDto[] = dtos.map((dto) => {
    let cashReceipt = 0;
    let cashPayment = 0;
    let bankReceipt = 0;
    let bankPayment = 0;

    for (const posting of dto.postings) {
      const klass = classes.get(posting.accountId);
      if (!klass) continue; // A leg outside the cash book's scope (e.g. a credit card).

      if (klass.column === 'cash') {
        if (posting.amountMinor > 0) cashReceipt += posting.amountMinor;
        else cashPayment += -posting.amountMinor;
      } else if (posting.amountMinor > 0) bankReceipt += posting.amountMinor;
      else bankPayment += -posting.amountMinor;
    }

    runningCash += cashReceipt - cashPayment;
    runningBank += bankReceipt - bankPayment;

    // Discounts sit on the income/expense side, mirroring the traditional layout.
    const discountAllowed = dto.type === 'income' ? (dto.discountMinor ?? 0) : 0;
    const discountReceived = dto.type === 'expense' ? (dto.discountMinor ?? 0) : 0;

    totals.cashReceiptMinor += cashReceipt;
    totals.cashPaymentMinor += cashPayment;
    totals.bankReceiptMinor += bankReceipt;
    totals.bankPaymentMinor += bankPayment;
    totals.receiptMinor += cashReceipt + bankReceipt;
    totals.paymentMinor += cashPayment + bankPayment;
    totals.discountAllowedMinor += discountAllowed;
    totals.discountReceivedMinor += discountReceived;

    return {
      id: dto.id,
      date: dto.date,
      particulars: particularsFor(dto),
      referenceNo: dto.referenceNo,
      receiptMinor: cashReceipt + bankReceipt,
      paymentMinor: cashPayment + bankPayment,
      cashReceiptMinor: cashReceipt,
      cashPaymentMinor: cashPayment,
      bankReceiptMinor: bankReceipt,
      bankPaymentMinor: bankPayment,
      discountAllowedMinor: discountAllowed,
      discountReceivedMinor: discountReceived,
      balanceMinor: runningCash + runningBank,
      cashBalanceMinor: runningCash,
      bankBalanceMinor: runningBank,
      // A transfer between two in-scope accounts is a contra entry: it appears on
      // both sides and nets to zero (§11).
      isContra: dto.type === 'transfer' && dto.postings.every((p) => classes.has(p.accountId)),
      type: dto.type,
      personName: dto.personName,
      categoryName: dto.categoryName,
    };
  });

  return {
    view: options.view,
    from: options.from.toISOString(),
    to: options.to.toISOString(),
    opening: {
      totalMinor: openingCash + openingBank,
      cashMinor: openingCash,
      bankMinor: openingBank,
    },
    closing: {
      totalMinor: runningCash + runningBank,
      cashMinor: runningCash,
      bankMinor: runningBank,
    },
    totals,
    rows,
  };
}

/** The "Particulars" column: what a person reading the book needs to see. */
function particularsFor(dto: {
  description: string;
  personName?: string;
  categoryName?: string;
  type: string;
  postings: Array<{ accountName?: string; amountMinor: number }>;
}): string {
  if (dto.description) return dto.description;

  if (dto.type === 'transfer') {
    const from = dto.postings.find((p) => p.amountMinor < 0)?.accountName ?? 'account';
    const to = dto.postings.find((p) => p.amountMinor > 0)?.accountName ?? 'account';
    return `Transfer — ${from} to ${to}`;
  }

  return dto.personName ?? dto.categoryName ?? 'Transaction';
}

function emptyCashBook(options: CashBookOptions): CashBookDto {
  return {
    view: options.view,
    from: options.from.toISOString(),
    to: options.to.toISOString(),
    opening: { totalMinor: 0, cashMinor: 0, bankMinor: 0 },
    closing: { totalMinor: 0, cashMinor: 0, bankMinor: 0 },
    totals: {
      receiptMinor: 0, paymentMinor: 0,
      cashReceiptMinor: 0, cashPaymentMinor: 0,
      bankReceiptMinor: 0, bankPaymentMinor: 0,
      discountAllowedMinor: 0, discountReceivedMinor: 0,
    },
    rows: [],
  };
}
