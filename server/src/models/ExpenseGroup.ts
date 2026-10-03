import { Schema, type Types } from 'mongoose';
import { defineModel, baseOptions, scopeFields } from './shared.js';

/**
 * A group of people a shared expense gets split among (§Phase 8, decision 1)
 * — a trip, flatmates, a family. Membership is just a list of `Person`
 * records already in the owner's workspace; there is no cross-account
 * sharing until Phase 9's household workspaces.
 */
export interface IExpenseGroup {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  memberPersonIds: Types.ObjectId[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const expenseGroupSchema = new Schema<IExpenseGroup>(
  {
    ...scopeFields(),
    name: { type: String, required: true, trim: true, maxlength: 60 },
    memberPersonIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Person' }],
      validate: {
        validator: (v: Types.ObjectId[]) => v.length > 0 && v.length <= 30,
        message: 'A group needs between 1 and 30 members.',
      },
    },
    isActive: { type: Boolean, default: true },
  },
  baseOptions,
);

expenseGroupSchema.index({ workspaceId: 1, isActive: 1 });

export const ExpenseGroup = defineModel<IExpenseGroup>('ExpenseGroup', expenseGroupSchema);
