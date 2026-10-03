import { Schema, type Types } from 'mongoose';
import { defineModel, baseOptions, moneyField, scopeFields } from './shared.js';

/**
 * A repayment schedule attached to one lend/borrow transaction (§Phase 4).
 *
 * Deliberately just a schedule — it has no `isPaid` flag of its own. Whether an
 * installment is paid is always derived from the loan's real `settledMinor`
 * (see `loan.service.ts#withInstallmentStatus`), the same value every other
 * loan view already trusts, so a plan can never say something the ledger
 * disagrees with.
 */
export interface IInstallment {
  dueDate: Date;
  amountMinor: number;
}

export interface IInstallmentPlan {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  transactionId: Types.ObjectId;
  installments: IInstallment[];
  createdAt: Date;
  updatedAt: Date;
}

const installmentSchema = new Schema<IInstallment>(
  {
    dueDate: { type: Date, required: true },
    amountMinor: moneyField({ required: true, signed: false }),
  },
  { _id: false },
);

const installmentPlanSchema = new Schema<IInstallmentPlan>(
  {
    ...scopeFields(),
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true },
    installments: {
      type: [installmentSchema],
      validate: {
        validator: (v: IInstallment[]) => v.length > 0 && v.length <= 60,
        message: 'An installment plan needs between 1 and 60 entries.',
      },
    },
  },
  baseOptions,
);

installmentPlanSchema.index({ workspaceId: 1, transactionId: 1 }, { unique: true });

export const InstallmentPlan = defineModel<IInstallmentPlan>('InstallmentPlan', installmentPlanSchema);
