import { Schema, type Types } from 'mongoose';
import { defineModel, baseOptions, moneyField, scopeFields } from './shared.js';

/**
 * A payment between two members of an expense group, full or partial. `null` on
 * either side is you. When you are one of the two, the money really moved in
 * your books, so `transactionId` points at the ordinary `repayment_given` /
 * `repayment_received` it posted as (and `accountId` at where it moved). A
 * payment between two other members is the group's record only — none of your
 * accounts or ledgers are touched by it.
 */
export interface IGroupSettlement {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  groupId: Types.ObjectId;
  fromPersonId: Types.ObjectId | null;
  toPersonId: Types.ObjectId | null;
  amountMinor: number;
  date: Date;
  accountId: Types.ObjectId | null;
  transactionId: Types.ObjectId | null;
  note: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const groupSettlementSchema = new Schema<IGroupSettlement>(
  {
    ...scopeFields(),
    groupId: { type: Schema.Types.ObjectId, ref: 'ExpenseGroup', required: true },
    fromPersonId: { type: Schema.Types.ObjectId, ref: 'Person', default: null },
    toPersonId: { type: Schema.Types.ObjectId, ref: 'Person', default: null },
    amountMinor: moneyField({ required: true, signed: false }),
    date: { type: Date, required: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
    note: { type: String, trim: true, maxlength: 200, default: '' },
    deletedAt: { type: Date, default: null },
  },
  baseOptions,
);

groupSettlementSchema.index({ workspaceId: 1, groupId: 1, date: -1 });
/** Is this transaction a group payment? — asked when restoring or listing deleted transactions (§Trash). */
groupSettlementSchema.index({ workspaceId: 1, transactionId: 1 }, { partialFilterExpression: { transactionId: { $type: 'objectId' } } });

export const GroupSettlement = defineModel<IGroupSettlement>('GroupSettlement', groupSettlementSchema);
