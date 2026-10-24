import { Schema, type Types } from 'mongoose';
import { GROUP_SPLIT_METHODS, type GroupSplitMethod } from '@khata/shared';
import { defineModel, baseOptions, moneyField, scopeFields } from './shared.js';

/**
 * One shared expense within a group (§Phase 8, decision 1). The money itself is
 * never tracked here: this is a record of *how* the total was split, pointing at
 * the real postings in your own books —
 *  - you paid: one `expense` for your own share, one `lend` per member with a
 *    share greater than zero (the cash really left your account);
 *  - a member paid and you had a share: a `borrow` from them and an `expense`
 *    for your share against the same account, which cancel on that account —
 *    you spent your share and now owe it to them;
 *  - a member paid and you had no share: nothing at all in your books.
 * Removing a `GroupExpense` deletes those transactions through the ordinary
 * `deleteTransaction` path (so UNDO, the audit trail and balance recalculation
 * all work exactly as they do for any other transaction) rather than this record
 * owning any financial state. Records made before members could pay have no
 * `paidByPersonId` — they were all paid by you, which is what `null` means.
 */
export interface IGroupExpenseMemberShare {
  personId: Types.ObjectId;
  amountMinor: number;
  /** Only when you paid: the `lend` this member's share posted as. */
  transactionId?: Types.ObjectId | null;
}

/** What was entered for one participant — a percentage, share count or exact amount. `personId: null` is you. */
export interface IGroupExpenseSplitInput {
  personId: Types.ObjectId | null;
  value?: number | null;
}

export interface IGroupExpense {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  groupId: Types.ObjectId;
  description: string;
  date: Date;
  totalAmountMinor: number;
  /** Paid from (you paid), or your share recorded against (a member paid). `null` when none of your accounts was involved. */
  accountId?: Types.ObjectId | null;
  categoryId?: Types.ObjectId | null;
  splitMethod: GroupSplitMethod;
  /** `null` (or absent, on older records) is you. */
  paidByPersonId?: Types.ObjectId | null;
  mySplitMinor: number;
  myExpenseTransactionId?: Types.ObjectId | null;
  myBorrowTransactionId?: Types.ObjectId | null;
  /** Every member other than you with a share greater than zero — including the payer, if they had one. */
  memberShares: IGroupExpenseMemberShare[];
  splitInputs: IGroupExpenseSplitInput[];
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const memberShareSchema = new Schema<IGroupExpenseMemberShare>(
  {
    personId: { type: Schema.Types.ObjectId, ref: 'Person', required: true },
    amountMinor: moneyField({ required: true, signed: false }),
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
  },
  { _id: false },
);

const splitInputSchema = new Schema<IGroupExpenseSplitInput>(
  {
    personId: { type: Schema.Types.ObjectId, ref: 'Person', default: null },
    value: { type: Number, default: null },
  },
  { _id: false },
);

const groupExpenseSchema = new Schema<IGroupExpense>(
  {
    ...scopeFields(),
    groupId: { type: Schema.Types.ObjectId, ref: 'ExpenseGroup', required: true },
    description: { type: String, trim: true, maxlength: 200, default: '' },
    date: { type: Date, required: true },
    totalAmountMinor: moneyField({ required: true, signed: false }),
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    splitMethod: { type: String, enum: GROUP_SPLIT_METHODS, required: true },
    paidByPersonId: { type: Schema.Types.ObjectId, ref: 'Person', default: null },
    mySplitMinor: moneyField({ required: true, signed: false }),
    myExpenseTransactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
    myBorrowTransactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
    memberShares: { type: [memberShareSchema], default: [] },
    splitInputs: { type: [splitInputSchema], default: [] },
    deletedAt: { type: Date, default: null },
  },
  baseOptions,
);

groupExpenseSchema.index({ workspaceId: 1, groupId: 1, date: -1 });

export const GroupExpense = defineModel<IGroupExpense>('GroupExpense', groupExpenseSchema);
