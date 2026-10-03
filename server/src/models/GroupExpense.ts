import { Schema, type Types } from 'mongoose';
import { GROUP_SPLIT_METHODS, type GroupSplitMethod } from '@khata/shared';
import { defineModel, baseOptions, moneyField, scopeFields } from './shared.js';

/**
 * One shared expense within a group (§Phase 8, decision 1) — always paid by
 * the current user. The money itself is never tracked here: this is a
 * record of *how* the total was split, pointing at the real postings —
 * one `expense` transaction for the user's own share, one `lend` per member
 * with a share greater than zero. Deleting a `GroupExpense` deletes those
 * transactions through the ordinary `deleteTransaction` path (so UNDO, the
 * audit trail and balance recalculation all work exactly as they do for any
 * other transaction) rather than this record owning any financial state.
 */
export interface IGroupExpenseMemberShare {
  personId: Types.ObjectId;
  amountMinor: number;
  transactionId?: Types.ObjectId | null;
}

export interface IGroupExpense {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  groupId: Types.ObjectId;
  description: string;
  date: Date;
  totalAmountMinor: number;
  accountId: Types.ObjectId;
  categoryId?: Types.ObjectId | null;
  splitMethod: GroupSplitMethod;
  mySplitMinor: number;
  myExpenseTransactionId?: Types.ObjectId | null;
  memberShares: IGroupExpenseMemberShare[];
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

const groupExpenseSchema = new Schema<IGroupExpense>(
  {
    ...scopeFields(),
    groupId: { type: Schema.Types.ObjectId, ref: 'ExpenseGroup', required: true },
    description: { type: String, trim: true, maxlength: 200, default: '' },
    date: { type: Date, required: true },
    totalAmountMinor: moneyField({ required: true, signed: false }),
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    splitMethod: { type: String, enum: GROUP_SPLIT_METHODS, required: true },
    mySplitMinor: moneyField({ required: true, signed: false }),
    myExpenseTransactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
    memberShares: { type: [memberShareSchema], default: [] },
  },
  baseOptions,
);

groupExpenseSchema.index({ workspaceId: 1, groupId: 1, date: -1 });

export const GroupExpense = defineModel<IGroupExpense>('GroupExpense', groupExpenseSchema);
