import { Schema, type HydratedDocument, type Types } from 'mongoose';
import {
  PAYMENT_METHODS,
  TRANSACTION_META,
  TRANSACTION_TYPES,
  type PaymentMethod,
  type TransactionType,
} from '@khata/shared';
import { defineModel, baseOptions, currencyField, moneyField, scopeFields, softDeleteFields, tagsField } from './shared.js';

/**
 * A single movement of money against one account.
 *
 * Signed: negative leaves the account, positive enters it. An income has one
 * posting, a transfer has two that sum to zero, and that is the entire reason a
 * transfer can never be double-counted or left half-applied (invariant I4) — it is
 * one document, so MongoDB's single-document atomicity does the work for us.
 */
export interface IPosting {
  accountId: Types.ObjectId;
  amountMinor: number;
}

export interface ITransaction {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;

  type: TransactionType;
  /** Always positive. Direction is carried by `type` and by posting signs. */
  amountMinor: number;
  currency: string;
  date: Date;

  postings: IPosting[];

  categoryId?: Types.ObjectId | null;
  subcategoryId?: Types.ObjectId | null;
  personId?: Types.ObjectId | null;

  /**
   * Signed effect on the person's ledger (ARCHITECTURE §3.3).
   * For person-type transactions this is always the exact negation of the account
   * posting, which `pre('validate')` enforces — money leaving your pocket towards
   * a person increases what they owe you, and vice versa.
   */
  personDeltaMinor: number;

  description: string;
  notes?: string;
  paymentMethod?: PaymentMethod;
  referenceNo?: string;
  tags: string[];
  attachmentIds: Types.ObjectId[];

  /** Lend/borrow: when repayment is expected. Drives reminders and the overdue flag. */
  dueDate?: Date | null;
  /** Repayments and settlements point at the lend/borrow they are paying down. */
  parentTransactionId?: Types.ObjectId | null;
  /**
   * Lend/borrow only: how much of this loan has been repaid so far.
   * Maintained with a guarded `$inc`, which is what makes over-repayment and
   * double-repayment races impossible without a multi-document transaction.
   */
  settledMinor: number;
  settledAt?: Date | null;
  /** Marks the closing entry created by "Settle Account" (§17). */
  isSettlement: boolean;

  /** Cash book triple-column: discount allowed (expense side) or received (income side). */
  discountMinor: number;

  recurringId?: Types.ObjectId | null;
  isRecurringInstance: boolean;

  /** Set for imported rows so an import can be reviewed or rolled back as a batch. */
  importBatchId?: string | null;
  /** Client-supplied key that makes a retried POST a no-op instead of a duplicate. */
  idempotencyKey?: string | null;

  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const postingSchema = new Schema<IPosting>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    amountMinor: moneyField({ required: true }),
  },
  { _id: false },
);

const transactionSchema = new Schema<ITransaction>(
  {
    ...scopeFields(),

    type: { type: String, enum: TRANSACTION_TYPES, required: true },
    amountMinor: moneyField({ required: true, signed: false }),
    currency: currencyField,
    date: { type: Date, required: true },

    postings: {
      type: [postingSchema],
      required: true,
      validate: {
        validator: (v: IPosting[]) => Array.isArray(v) && v.length >= 1 && v.length <= 2,
        message: 'A transaction must have one posting, or two for a transfer.',
      },
    },

    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    subcategoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    personId: { type: Schema.Types.ObjectId, ref: 'Person', default: null },
    personDeltaMinor: moneyField({ default: 0 }),

    description: { type: String, trim: true, maxlength: 200, default: '' },
    notes: { type: String, trim: true, maxlength: 2000 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS },
    referenceNo: { type: String, trim: true, maxlength: 60 },
    tags: tagsField,
    attachmentIds: { type: [Schema.Types.ObjectId], ref: 'Attachment', default: [] },

    dueDate: { type: Date, default: null },
    parentTransactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
    settledMinor: moneyField({ default: 0, signed: false }),
    settledAt: { type: Date, default: null },
    isSettlement: { type: Boolean, default: false },

    discountMinor: moneyField({ default: 0, signed: false }),

    recurringId: { type: Schema.Types.ObjectId, ref: 'RecurringTransaction', default: null },
    isRecurringInstance: { type: Boolean, default: false },

    importBatchId: { type: String, default: null },
    idempotencyKey: { type: String, default: null },

    ...softDeleteFields,
  },
  baseOptions,
);

// ─────────────────────────────────────────────── Indexes
//
// Large transaction histories have to stay fast (§58). Every index below backs a
// query the app actually issues; the leading `workspaceId` on all of them is what
// makes the data-isolation guarantee cheap rather than expensive.

/** Transaction list, cash book, reports: scoped and sorted by date descending. */
transactionSchema.index({ workspaceId: 1, deletedAt: 1, date: -1, _id: -1 });
/** Per-account ledger and running balance (§52). */
transactionSchema.index({ workspaceId: 1, 'postings.accountId': 1, deletedAt: 1, date: 1, _id: 1 });
/** Person ledger (§13). */
transactionSchema.index({ workspaceId: 1, personId: 1, deletedAt: 1, date: 1, _id: 1 });
/** Category reports and budget consumption. */
transactionSchema.index({ workspaceId: 1, categoryId: 1, deletedAt: 1, date: -1 });
/** Type filters and income/expense aggregates. */
transactionSchema.index({ workspaceId: 1, type: 1, deletedAt: 1, date: -1 });
/** Outstanding loans: unsettled lend/borrow rows with a due date. */
transactionSchema.index({ workspaceId: 1, type: 1, settledAt: 1, dueDate: 1 });
/** Repayment lookups when paying down a specific loan. */
transactionSchema.index({ parentTransactionId: 1, deletedAt: 1 });
/** Recurring instances, for "skip this month" and de-duplication. */
transactionSchema.index({ recurringId: 1, date: 1 });
/** Global search (§23). */
transactionSchema.index(
  { description: 'text', notes: 'text', referenceNo: 'text', tags: 'text' },
  { name: 'transaction_search', weights: { description: 10, referenceNo: 6, tags: 4, notes: 2 } },
);
/** Idempotent creates — sparse so the overwhelming majority of rows cost nothing. */
transactionSchema.index(
  { workspaceId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
transactionSchema.index({ workspaceId: 1, importBatchId: 1 }, { sparse: true });

// ─────────────────────────────────────────────── Integrity checks
//
// These run on every write. They are the last line of defence for §51: even if a
// service layer bug constructed a nonsensical transaction, it cannot be persisted.

transactionSchema.pre('validate', function (this: HydratedDocument<ITransaction>, next) {
  const meta = TRANSACTION_META[this.type];
  if (!meta) return next(new Error(`Unknown transaction type: ${this.type}`));

  if (!(this.amountMinor > 0)) {
    return next(new Error('Amount must be greater than zero.'));
  }

  // — Posting shape must match the type.
  if (meta.isTransfer) {
    if (this.postings.length !== 2) {
      return next(new Error('A transfer must post to exactly two accounts.'));
    }
    const [a, b] = this.postings as [IPosting, IPosting];
    if (String(a.accountId) === String(b.accountId)) {
      return next(new Error('Choose two different accounts for a transfer.'));
    }
    // The two legs must cancel out: this is invariant I5 in its strongest form —
    // a transfer that changes total net cash is not a transfer.
    if (a.amountMinor + b.amountMinor !== 0) {
      return next(new Error('Transfer legs must cancel out exactly.'));
    }
    if (Math.abs(a.amountMinor) !== this.amountMinor) {
      return next(new Error('Transfer legs must equal the transaction amount.'));
    }
  } else {
    if (this.postings.length !== 1) {
      return next(new Error('Only a transfer may post to more than one account.'));
    }
    const posting = this.postings[0]!;
    if (Math.abs(posting.amountMinor) !== this.amountMinor) {
      return next(new Error('The posting must equal the transaction amount.'));
    }
    if (meta.direction === 'in' && posting.amountMinor <= 0) {
      return next(new Error(`A ${meta.label.toLowerCase()} must increase the account balance.`));
    }
    if (meta.direction === 'out' && posting.amountMinor >= 0) {
      return next(new Error(`A ${meta.label.toLowerCase()} must decrease the account balance.`));
    }
  }

  // — Person legs.
  if (meta.isPersonal) {
    if (!this.personId) {
      return next(new Error(`A ${meta.label.toLowerCase()} must be linked to a person.`));
    }
    const accountLeg = this.postings[0]!.amountMinor;
    // Money out of your pocket to a person increases what they owe you, and money
    // into your pocket from a person decreases it. Always the exact negation.
    const expected = -accountLeg;
    if (this.personDeltaMinor !== expected) {
      return next(
        new Error('The person ledger entry does not mirror the account entry — refusing to save.'),
      );
    }
  } else if (this.personDeltaMinor !== 0) {
    return next(new Error('Only lending, borrowing and repayments may affect a person ledger.'));
  }

  // — Lending and borrowing are never income or expense (invariant I6).
  if (meta.isPersonal && this.categoryId) {
    return next(new Error('Lending and borrowing are not categorised as income or expense.'));
  }

  // — Repayment bookkeeping.
  if (this.type === 'repayment_given' || this.type === 'repayment_received') {
    if (this.settledMinor !== 0) {
      return next(new Error('A repayment does not itself carry a settled amount.'));
    }
  }
  if (this.settledMinor > this.amountMinor) {
    return next(new Error('Settled amount cannot exceed the original amount.'));
  }

  // — Only lend/borrow carry a due date.
  if (this.dueDate && !(this.type === 'lend' || this.type === 'borrow')) {
    this.dueDate = null;
  }

  next();
});

/** `outstanding = amount − settled`. Exposed as a virtual so it can never drift. */
transactionSchema.virtual('outstandingMinor').get(function (this: ITransaction) {
  if (this.type !== 'lend' && this.type !== 'borrow') return 0;
  return Math.max(0, this.amountMinor - this.settledMinor);
});

transactionSchema.virtual('isSettled').get(function (this: ITransaction) {
  if (this.type !== 'lend' && this.type !== 'borrow') return true;
  return this.settledMinor >= this.amountMinor;
});

export const Transaction = defineModel<ITransaction>('Transaction', transactionSchema);
