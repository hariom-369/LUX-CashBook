import { Types, type HydratedDocument } from 'mongoose';
import { allocateProportionally } from '@khata/shared';
import type {
  ExpenseGroupDto,
  GroupExpenseDto,
  GroupMemberBalanceDto,
  GroupSplitMethod,
} from '@khata/shared';
import {
  Account,
  Category,
  ExpenseGroup,
  GroupExpense,
  Person,
  Transaction,
  type IExpenseGroup,
  type IGroupExpense,
} from '../../models/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';
import { withTransaction } from '../../lib/transaction.js';
import { createTransaction, deleteTransaction } from '../transactions/transaction.service.js';
import { excludeHiddenTransactions } from '../../services/accountVisibility.js';
import { visibleAccountIds } from '../../services/accountVisibility.js';

/**
 * Expense groups (§Phase 8, decision 1): a group expense you paid is always
 * one `expense` (your own share) plus one `lend` per member whose share is
 * greater than zero, created atomically and linked back by this record. This
 * is why a group never needs its own "debt simplification" — every member
 * owes *you* directly (you fronted their share), never each other, so there
 * is no multi-party graph to simplify. "Settle" is just the ordinary
 * person-repayment flow, already built.
 */

async function nameMap(personIds: Types.ObjectId[]): Promise<Map<string, string>> {
  if (personIds.length === 0) return new Map();
  const people = await Person.find({ _id: { $in: personIds } }).select('name').lean();
  return new Map(people.map((p) => [String(p._id), p.name]));
}

export function toGroupDto(group: IExpenseGroup, memberNames: Map<string, string>): ExpenseGroupDto {
  return {
    id: String(group._id),
    workspaceId: String(group.workspaceId),
    name: group.name,
    memberPersonIds: group.memberPersonIds.map(String),
    memberNames: group.memberPersonIds.map((id) => memberNames.get(String(id)) ?? 'Unknown'),
    isActive: group.isActive,
    createdAt: group.createdAt.toISOString(),
  };
}

export interface CreateGroupInput {
  name: string;
  memberPersonIds: string[];
}

async function assertMembersBelong(scope: RequestScope, memberPersonIds: string[]): Promise<Types.ObjectId[]> {
  const ids = [...new Set(memberPersonIds)];
  if (ids.length === 0) throw badRequest('Add at least one member.');
  if (!ids.every((id) => Types.ObjectId.isValid(id))) throw notFound('Person');

  const people = await Person.find({ _id: { $in: ids }, workspaceId: scope.workspaceId, deletedAt: null }).select('_id').lean();
  if (people.length !== ids.length) throw notFound('Person');
  return ids.map((id) => new Types.ObjectId(id));
}

export async function createGroup(scope: RequestScope, input: CreateGroupInput, audit: AuditContext): Promise<HydratedDocument<IExpenseGroup>> {
  const memberPersonIds = await assertMembersBelong(scope, input.memberPersonIds);

  const group = await ExpenseGroup.create({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    name: input.name.trim(),
    memberPersonIds,
  });

  await recordAudit(audit, {
    action: 'created',
    entityType: 'ExpenseGroup',
    entityId: group._id,
    summary: `Created group "${group.name}"`,
  });

  return group;
}

export async function listGroups(scope: RequestScope): Promise<ExpenseGroupDto[]> {
  const groups = await ExpenseGroup.find({ workspaceId: scope.workspaceId, isActive: true }).sort({ createdAt: -1 }).lean();
  const names = await nameMap(groups.flatMap((g) => g.memberPersonIds));
  return groups.map((g) => toGroupDto(g, names));
}

async function getGroupDoc(scope: RequestScope, groupId: string): Promise<HydratedDocument<IExpenseGroup>> {
  if (!Types.ObjectId.isValid(groupId)) throw notFound('Group');
  const group = await ExpenseGroup.findOne({ _id: groupId, workspaceId: scope.workspaceId });
  if (!group) throw notFound('Group');
  return group;
}

export async function getGroup(scope: RequestScope, groupId: string): Promise<ExpenseGroupDto> {
  const group = await getGroupDoc(scope, groupId);
  const names = await nameMap(group.memberPersonIds);
  return toGroupDto(group, names);
}

export async function archiveGroup(scope: RequestScope, groupId: string, audit: AuditContext): Promise<void> {
  const group = await getGroupDoc(scope, groupId);
  group.isActive = false;
  await group.save();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'ExpenseGroup',
    entityId: group._id,
    summary: `Archived group "${group.name}"`,
  });
}

// ─────────────────────────────────────────────── Group expenses

function toGroupExpenseDto(
  expense: IGroupExpense,
  names: Map<string, string>,
  accountName?: string,
  categoryName?: string,
): GroupExpenseDto {
  return {
    id: String(expense._id),
    groupId: String(expense.groupId),
    description: expense.description,
    date: expense.date.toISOString(),
    totalAmountMinor: expense.totalAmountMinor,
    accountId: String(expense.accountId),
    accountName,
    categoryId: expense.categoryId ? String(expense.categoryId) : undefined,
    categoryName,
    splitMethod: expense.splitMethod,
    mySplitMinor: expense.mySplitMinor,
    myExpenseTransactionId: expense.myExpenseTransactionId ? String(expense.myExpenseTransactionId) : undefined,
    memberShares: expense.memberShares.map((s) => ({
      personId: String(s.personId),
      personName: names.get(String(s.personId)),
      amountMinor: s.amountMinor,
      transactionId: s.transactionId ? String(s.transactionId) : undefined,
    })),
    createdAt: expense.createdAt.toISOString(),
  };
}

export interface AddGroupExpenseInput {
  description: string;
  date: Date;
  accountId: string;
  categoryId?: string | null;
  splitMethod: GroupSplitMethod;
  /**
   * One entry per participant, `personId: null` representing the current
   * user's own share. `value` means: the exact amount (`exact`), a
   * percentage (`percentage`), a share count (`shares`), or is ignored
   * (`equal`, which splits evenly across every entry here).
   */
  participants: Array<{ personId: string | null; value?: number }>;
  totalAmountMinor: number;
}

function computeShares(input: AddGroupExpenseInput): number[] {
  const weights = input.participants.map((p) => {
    switch (input.splitMethod) {
      case 'equal':
        return 1;
      case 'percentage':
      case 'shares':
        return p.value ?? 0;
      case 'exact':
        return 0; // exact amounts are used directly below, not via weights
      default:
        return 0;
    }
  });

  if (input.splitMethod === 'exact') {
    return input.participants.map((p) => p.value ?? 0);
  }
  return allocateProportionally(input.totalAmountMinor, weights);
}

export async function addGroupExpense(
  scope: RequestScope,
  groupId: string,
  input: AddGroupExpenseInput,
  audit: AuditContext,
): Promise<IGroupExpense> {
  const group = await getGroupDoc(scope, groupId);
  if (input.participants.length === 0) throw badRequest('Add at least one participant.');

  const memberIds = new Set(group.memberPersonIds.map(String));
  for (const p of input.participants) {
    if (p.personId && !memberIds.has(p.personId)) throw badRequest('Every participant must be a member of this group.');
  }

  const shares = computeShares(input);
  const sum = shares.reduce((s, v) => s + v, 0);
  if (sum !== input.totalAmountMinor) {
    throw badRequest('The split must add up exactly to the total amount.');
  }
  if (shares.some((s) => s < 0)) throw badRequest('A share cannot be negative.');

  const account = await Account.findOne({ _id: visibleAccountIds(scope, input.accountId), workspaceId: scope.workspaceId, deletedAt: null }).lean();
  if (!account) throw notFound('Account');
  if (account.visibility === 'private' && String(account.userId) !== String(scope.userId)) {
    throw notFound('Account');
  }

  let mySplitMinor = 0;
  const memberSharesInput: Array<{ personId: string; amountMinor: number }> = [];
  input.participants.forEach((p, i) => {
    if (p.personId === null) mySplitMinor += shares[i]!;
    else if (shares[i]! > 0) memberSharesInput.push({ personId: p.personId, amountMinor: shares[i]! });
  });

  return withTransaction(async (uow) => {
    let myExpenseTransactionId: Types.ObjectId | undefined;
    if (mySplitMinor > 0) {
      const txn = await createTransaction(
        scope,
        {
          type: 'expense',
          amountMinor: mySplitMinor,
          date: input.date,
          accountId: input.accountId,
          categoryId: input.categoryId ?? null,
          description: input.description,
        },
        audit,
        uow,
      );
      myExpenseTransactionId = txn._id;
    }

    const memberShares: Array<{ personId: Types.ObjectId; amountMinor: number; transactionId?: Types.ObjectId }> = [];
    for (const share of memberSharesInput) {
      const txn = await createTransaction(
        scope,
        {
          type: 'lend',
          amountMinor: share.amountMinor,
          date: input.date,
          accountId: input.accountId,
          personId: share.personId,
          description: input.description,
        },
        audit,
        uow,
      );
      memberShares.push({ personId: new Types.ObjectId(share.personId), amountMinor: share.amountMinor, transactionId: txn._id });
    }

    const [expense] = await GroupExpense.create(
      [
        {
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          groupId: group._id,
          description: input.description.trim(),
          date: input.date,
          totalAmountMinor: input.totalAmountMinor,
          accountId: input.accountId,
          categoryId: input.categoryId,
          splitMethod: input.splitMethod,
          mySplitMinor,
          myExpenseTransactionId,
          memberShares,
        },
      ],
      { session: uow.session, ordered: true },
    );

    // Link the transactions back for display (e.g. a "part of a group expense" badge).
    const groupExpenseDoc = expense!;
    const linkedIds = [myExpenseTransactionId, ...memberShares.map((m) => m.transactionId)].filter(Boolean);
    if (linkedIds.length > 0) {
      await Transaction.updateMany(
        { _id: { $in: linkedIds } },
        { $set: { groupExpenseId: groupExpenseDoc._id } },
        { session: uow.session },
      );
    }

    await recordAudit(audit, {
      action: 'created',
      entityType: 'GroupExpense',
      entityId: groupExpenseDoc._id,
      summary: `Added "${groupExpenseDoc.description}" to group expenses`,
    });

    return groupExpenseDoc;
  });
}

export async function listGroupExpenses(scope: RequestScope, groupId: string): Promise<GroupExpenseDto[]> {
  const group = await getGroupDoc(scope, groupId);
  const expenses = await GroupExpense.find({
    workspaceId: scope.workspaceId,
    groupId: group._id,
    // Paid from another member's private account: not theirs to see.
    ...(scope.hiddenAccountIds.length > 0 ? { accountId: { $nin: scope.hiddenAccountIds } } : {}),
  })
    .sort({ date: -1 })
    .lean();
  if (expenses.length === 0) return [];

  const names = await nameMap(expenses.flatMap((e) => e.memberShares.map((s) => s.personId)));
  const accountIds = [...new Set(expenses.map((e) => String(e.accountId)))];
  const categoryIds = expenses.map((e) => e.categoryId).filter(Boolean) as Types.ObjectId[];
  const [accounts, categories] = await Promise.all([
    Account.find({ _id: { $in: accountIds } }).select('name').lean(),
    categoryIds.length ? Category.find({ _id: { $in: categoryIds } }).select('name').lean() : [],
  ]);
  const accountName = new Map(accounts.map((a) => [String(a._id), a.name]));
  const categoryName = new Map(categories.map((c) => [String(c._id), c.name]));

  return expenses.map((e) =>
    toGroupExpenseDto(e, names, accountName.get(String(e.accountId)), e.categoryId ? categoryName.get(String(e.categoryId)) : undefined),
  );
}

export async function deleteGroupExpense(scope: RequestScope, groupId: string, expenseId: string, audit: AuditContext): Promise<void> {
  const group = await getGroupDoc(scope, groupId);
  if (!Types.ObjectId.isValid(expenseId)) throw notFound('Group expense');
  const expense = await GroupExpense.findOne({ _id: expenseId, workspaceId: scope.workspaceId, groupId: group._id });
  if (!expense || scope.hiddenAccountIds.some((h) => h.equals(expense.accountId))) throw notFound('Group expense');

  const transactionIds = [expense.myExpenseTransactionId, ...expense.memberShares.map((s) => s.transactionId)].filter(
    (id): id is Types.ObjectId => Boolean(id),
  );
  for (const id of transactionIds) {
    await deleteTransaction(scope, String(id), audit);
  }

  await expense.deleteOne();

  await recordAudit(audit, {
    action: 'deleted',
    entityType: 'GroupExpense',
    entityId: expense._id,
    summary: `Removed "${expense.description}" from group expenses`,
  });
}

/** Each member's outstanding balance across the group — straight from the real `lend` transactions, never a second total. */
export async function getGroupBalances(scope: RequestScope, groupId: string): Promise<GroupMemberBalanceDto[]> {
  const group = await getGroupDoc(scope, groupId);
  const names = await nameMap(group.memberPersonIds);

  const expenses = await GroupExpense.find({ workspaceId: scope.workspaceId, groupId: group._id })
    .select('memberShares')
    .lean();
  const transactionIds = expenses.flatMap((e) => e.memberShares.map((s) => s.transactionId)).filter(
    (id): id is Types.ObjectId => Boolean(id),
  );
  const loans = transactionIds.length
    ? await Transaction.find({ _id: { $in: transactionIds }, deletedAt: null, ...excludeHiddenTransactions(scope) }).select('personId amountMinor settledMinor').lean()
    : [];

  const outstandingByPerson = new Map<string, number>();
  for (const loan of loans) {
    const key = String(loan.personId);
    const outstanding = Math.max(0, loan.amountMinor - loan.settledMinor);
    outstandingByPerson.set(key, (outstandingByPerson.get(key) ?? 0) + outstanding);
  }

  return group.memberPersonIds.map((id) => ({
    personId: String(id),
    personName: names.get(String(id)) ?? 'Unknown',
    outstandingMinor: outstandingByPerson.get(String(id)) ?? 0,
  }));
}
