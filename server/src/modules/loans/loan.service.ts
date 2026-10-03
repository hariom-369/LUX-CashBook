import { Types } from 'mongoose';
import type { InstallmentPlanDto, LoanTimelineEntryDto } from '@khata/shared';
import { InstallmentPlan, Person, Transaction, type IInstallmentPlan, type ITransaction } from '../../models/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';
import { hydrate } from '../transactions/transaction.query.js';
import { excludeHiddenTransactions } from '../../services/accountVisibility.js';

/**
 * Per-loan timeline and installment schedules (§Phase 4: "Timeline per loan
 * ... remaining"). Reads the same `Transaction` collection the ledger already
 * trusts — a loan's remaining balance here is always `amountMinor -
 * settledMinor`, exactly what the person ledger and every report already show,
 * never a second calculation that could drift from it.
 */

async function getLoanTransaction(scope: RequestScope, transactionId: string): Promise<ITransaction> {
  if (!Types.ObjectId.isValid(transactionId)) throw notFound('Loan');
  const loan = await Transaction.findOne({
    _id: transactionId,
    workspaceId: scope.workspaceId,
    deletedAt: null,
    type: { $in: ['lend', 'borrow'] },
    ...excludeHiddenTransactions(scope),
  });
  if (!loan) throw notFound('Loan');
  return loan;
}

function toInstallmentPlanDto(plan: IInstallmentPlan, loan: ITransaction): InstallmentPlanDto {
  let cumulative = 0;
  const sorted = [...plan.installments].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const now = new Date();

  return {
    id: String(plan._id),
    transactionId: String(plan.transactionId),
    installments: sorted.map((installment) => {
      cumulative += installment.amountMinor;
      const status = cumulative <= loan.settledMinor ? 'paid' : installment.dueDate < now ? 'overdue' : 'upcoming';
      return { dueDate: installment.dueDate.toISOString(), amountMinor: installment.amountMinor, status };
    }),
  };
}

export async function getPersonTimeline(scope: RequestScope, personId: string): Promise<LoanTimelineEntryDto[]> {
  if (!Types.ObjectId.isValid(personId)) throw notFound('Person');
  const person = await Person.findOne({ _id: personId, workspaceId: scope.workspaceId, deletedAt: null }).lean();
  if (!person) throw notFound('Person');

  const loans = await Transaction.find({
    workspaceId: scope.workspaceId,
    personId: person._id,
    deletedAt: null,
    type: { $in: ['lend', 'borrow'] },
    ...excludeHiddenTransactions(scope),
  })
    .sort({ date: -1, _id: -1 })
    .lean();
  if (loans.length === 0) return [];

  const loanIds = loans.map((l) => l._id);
  const repayments = await Transaction.find({
    workspaceId: scope.workspaceId,
    deletedAt: null,
    parentTransactionId: { $in: loanIds },
    ...excludeHiddenTransactions(scope),
  })
    .sort({ date: 1, _id: 1 })
    .lean();

  const plans = await InstallmentPlan.find({ workspaceId: scope.workspaceId, transactionId: { $in: loanIds } }).lean();
  const planByLoan = new Map(plans.map((p) => [String(p.transactionId), p]));

  const [loanDtos, repaymentDtos] = await Promise.all([hydrate(scope, loans), hydrate(scope, repayments)]);
  const loanDtoById = new Map(loanDtos.map((d) => [d.id, d]));
  const repaymentsByLoan = new Map<string, typeof repaymentDtos>();
  for (const dto of repaymentDtos) {
    if (!dto.parentTransactionId) continue;
    const list = repaymentsByLoan.get(dto.parentTransactionId) ?? [];
    list.push(dto);
    repaymentsByLoan.set(dto.parentTransactionId, list);
  }

  return loans.map((loan) => {
    const id = String(loan._id);
    const plan = planByLoan.get(id);
    return {
      loan: loanDtoById.get(id)!,
      repayments: repaymentsByLoan.get(id) ?? [],
      remainingMinor: loan.amountMinor - loan.settledMinor,
      installmentPlan: plan ? toInstallmentPlanDto(plan, loan) : undefined,
    };
  });
}

export async function getInstallmentPlan(scope: RequestScope, transactionId: string): Promise<InstallmentPlanDto | null> {
  const loan = await getLoanTransaction(scope, transactionId);
  const plan = await InstallmentPlan.findOne({ workspaceId: scope.workspaceId, transactionId: loan._id }).lean();
  return plan ? toInstallmentPlanDto(plan, loan) : null;
}

export async function setInstallmentPlan(
  scope: RequestScope,
  transactionId: string,
  installments: Array<{ dueDate: Date; amountMinor: number }>,
  audit: AuditContext,
): Promise<InstallmentPlanDto> {
  const loan = await getLoanTransaction(scope, transactionId);
  const total = installments.reduce((sum, i) => sum + i.amountMinor, 0);
  if (total > loan.amountMinor) {
    throw badRequest('The installment total cannot exceed the loan amount.');
  }

  const plan = await InstallmentPlan.findOneAndUpdate(
    { workspaceId: scope.workspaceId, transactionId: loan._id },
    { $set: { userId: scope.userId, workspaceId: scope.workspaceId, transactionId: loan._id, installments } },
    { upsert: true, new: true },
  );

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'Transaction',
    entityId: loan._id,
    summary: `Set an installment schedule for a loan (${installments.length} installments)`,
  });

  return toInstallmentPlanDto(plan, loan);
}

export async function deleteInstallmentPlan(scope: RequestScope, transactionId: string, audit: AuditContext): Promise<void> {
  const loan = await getLoanTransaction(scope, transactionId);
  await InstallmentPlan.deleteOne({ workspaceId: scope.workspaceId, transactionId: loan._id });

  await recordAudit(audit, {
    action: 'deleted',
    entityType: 'Transaction',
    entityId: loan._id,
    summary: "Removed the loan's installment schedule",
  });
}
