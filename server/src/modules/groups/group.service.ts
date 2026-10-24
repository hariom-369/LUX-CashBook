import { Types, type HydratedDocument } from 'mongoose';
import {
  allocateProportionally,
  computeDirectBalances,
  computeGroupPositions,
  residualBalance,
  suggestGroupSettlements,
  type GroupLedgerExpense,
  type GroupLedgerSettlement,
} from '@khata/shared';
import type {
  ExpenseGroupDto,
  GroupExpenseDto,
  GroupMemberBalanceDto,
  GroupSettlementDto,
  GroupSplitMethod,
  GroupSummaryDto,
} from '@khata/shared';
import {
  Account,
  Category,
  ExpenseGroup,
  GroupExpense,
  GroupSettlement,
  Person,
  Transaction,
  type IExpenseGroup,
  type IGroupExpense,
  type IGroupSettlement,
} from '../../models/index.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';
import { withTransaction, type UnitOfWork } from '../../lib/transaction.js';
import { createTransaction, deleteTransaction, updateTransaction } from '../transactions/transaction.service.js';
import { excludeHiddenTransactions } from '../../services/accountVisibility.js';
import { visibleAccountIds } from '../../services/accountVisibility.js';

/**
 * Expense groups (§Phase 8, decision 1, extended so any member can pay).
 *
 * The group keeps its own record of who paid what, how each expense was split
 * and which payments have been made — that record is what balances and
 * settle-up suggestions are computed from (`@khata/shared` groups.ts). Your own
 * books only ever see the parts that are really yours, posted through the
 * ordinary transaction engine:
 *  - you paid: an `expense` for your share and a `lend` per member's share;
 *  - a member paid and you had a share: a `borrow` from them and an `expense`
 *    for your share on one account, cancelling on that account;
 *  - a payment between you and a member: a `repayment_given`/`_received`.
 * Expenses and payments between other members never touch your accounts,
 * income, expenses or People ledger. Because your share is always posted as
 * exactly one `expense`, and everything else as loans and repayments (which no
 * report counts as income or expense, invariant I6), nothing is double counted.
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

const MAX_MEMBERS = 30;

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
  const group = await ExpenseGroup.findOne({ _id: groupId, workspaceId: scope.workspaceId, deletedAt: null });
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
  // Out of Groups and into Trash (§Trash) for 30 days. Its expenses, payments and the entries in
  // your own books are untouched — restoring brings the whole group back exactly as it was.
  group.isActive = false;
  group.deletedAt = new Date();
  group.deletedBy = scope.userId;
  await group.save();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'ExpenseGroup',
    entityId: group._id,
    summary: `Archived group "${group.name}"`,
  });
}

export async function renameGroup(scope: RequestScope, groupId: string, name: string, audit: AuditContext): Promise<void> {
  const group = await getGroupDoc(scope, groupId);
  const before = group.name;
  group.name = name.trim();
  await group.save();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'ExpenseGroup',
    entityId: group._id,
    summary: `Renamed group "${before}" to "${group.name}"`,
  });
}

// ─────────────────────────────────────────────── Members

export async function addGroupMembers(scope: RequestScope, groupId: string, personIds: string[], audit: AuditContext): Promise<void> {
  const group = await getGroupDoc(scope, groupId);
  const toAdd = await assertMembersBelong(scope, personIds);
  const existing = new Set(group.memberPersonIds.map(String));
  const fresh = toAdd.filter((id) => !existing.has(String(id)));
  if (fresh.length === 0) return;
  if (group.memberPersonIds.length + fresh.length > MAX_MEMBERS) throw badRequest('A group can have at most 30 members.');

  group.memberPersonIds.push(...fresh);
  await group.save();

  const names = await nameMap(fresh);
  await recordAudit(audit, {
    action: 'updated',
    entityType: 'ExpenseGroup',
    entityId: group._id,
    summary: `Added ${fresh.map((id) => names.get(String(id)) ?? 'a member').join(', ')} to group "${group.name}"`,
  });
}

/**
 * A member can only leave a group nothing refers to them in — otherwise the
 * expenses and payments they were part of would stop adding up.
 */
export async function removeGroupMember(scope: RequestScope, groupId: string, personId: string, audit: AuditContext): Promise<void> {
  const group = await getGroupDoc(scope, groupId);
  if (!group.memberPersonIds.some((id) => String(id) === personId)) throw badRequest('That person is not a member of this group.');
  if (group.memberPersonIds.length === 1) throw badRequest('A group needs at least one member besides you.');

  const id = new Types.ObjectId(personId);
  const [inExpense, inSettlement] = await Promise.all([
    GroupExpense.exists({
      workspaceId: scope.workspaceId,
      groupId: group._id,
      deletedAt: null,
      $or: [{ paidByPersonId: id }, { 'memberShares.personId': id }, { 'splitInputs.personId': id }],
    }),
    GroupSettlement.exists({ workspaceId: scope.workspaceId, groupId: group._id, deletedAt: null, $or: [{ fromPersonId: id }, { toPersonId: id }] }),
  ]);
  if (inExpense || inSettlement) {
    throw conflict('This member is part of recorded expenses or payments in this group. Remove those first.', 'GROUP_MEMBER_IN_USE');
  }

  group.memberPersonIds = group.memberPersonIds.filter((m) => String(m) !== personId);
  await group.save();

  const names = await nameMap([id]);
  await recordAudit(audit, {
    action: 'updated',
    entityType: 'ExpenseGroup',
    entityId: group._id,
    summary: `Removed ${names.get(personId) ?? 'a member'} from group "${group.name}"`,
  });
}

// ─────────────────────────────────────────────── Group expenses

function toGroupExpenseDto(
  expense: IGroupExpense,
  names: Map<string, string>,
  accountName?: string,
  categoryName?: string,
): GroupExpenseDto {
  const paidBy = expense.paidByPersonId ?? null;
  return {
    id: String(expense._id),
    groupId: String(expense.groupId),
    description: expense.description,
    date: expense.date.toISOString(),
    totalAmountMinor: expense.totalAmountMinor,
    accountId: expense.accountId ? String(expense.accountId) : undefined,
    accountName,
    categoryId: expense.categoryId ? String(expense.categoryId) : undefined,
    categoryName,
    splitMethod: expense.splitMethod,
    mySplitMinor: expense.mySplitMinor,
    myExpenseTransactionId: expense.myExpenseTransactionId ? String(expense.myExpenseTransactionId) : undefined,
    myBorrowTransactionId: expense.myBorrowTransactionId ? String(expense.myBorrowTransactionId) : undefined,
    memberShares: expense.memberShares.map((s) => ({
      personId: String(s.personId),
      personName: names.get(String(s.personId)),
      amountMinor: s.amountMinor,
      transactionId: s.transactionId ? String(s.transactionId) : undefined,
    })),
    paidByPersonId: paidBy ? String(paidBy) : null,
    paidByName: paidBy ? names.get(String(paidBy)) : undefined,
    splitInputs: (expense.splitInputs ?? []).map((i) => ({
      personId: i.personId ? String(i.personId) : null,
      value: i.value ?? undefined,
    })),
    createdAt: expense.createdAt.toISOString(),
  };
}

export interface AddGroupExpenseInput {
  description: string;
  date: Date;
  /** Required when you paid, or when a member paid and you have a share. */
  accountId?: string | null;
  categoryId?: string | null;
  splitMethod: GroupSplitMethod;
  /**
   * One entry per participant, `personId: null` representing the current
   * user's own share. `value` means: the exact amount (`exact`), a
   * percentage (`percentage`), a share count (`shares`), or is ignored
   * (`equal`, which splits evenly across every entry here). Anyone left out
   * is excluded from this expense.
   */
  participants: Array<{ personId: string | null; value?: number }>;
  totalAmountMinor: number;
  /** Who paid. Omitted or `null`: you. */
  paidByPersonId?: string | null;
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

/** A validated expense, ready to post: who paid, and every participant's exact share. */
interface ExpensePlan {
  paidBy: string | null;
  mySplitMinor: number;
  memberShares: Array<{ personId: string; amountMinor: number }>;
  /** The account your part posts to, or `null` when none of your money is involved. */
  accountId: string | null;
}

async function planExpense(scope: RequestScope, group: IExpenseGroup, input: AddGroupExpenseInput): Promise<ExpensePlan> {
  if (input.participants.length === 0) throw badRequest('Add at least one participant.');

  const memberIds = new Set(group.memberPersonIds.map(String));
  for (const p of input.participants) {
    if (p.personId && !memberIds.has(p.personId)) throw badRequest('Every participant must be a member of this group.');
  }
  const seen = new Set(input.participants.map((p) => p.personId ?? 'me'));
  if (seen.size !== input.participants.length) throw badRequest('Each person can only appear once in a split.');

  const paidBy = input.paidByPersonId ?? null;
  if (paidBy !== null && !memberIds.has(paidBy)) throw badRequest('Whoever paid must be a member of this group.');

  if (input.splitMethod === 'percentage') {
    const total = input.participants.reduce((sum, p) => sum + (p.value ?? 0), 0);
    if (Math.abs(total - 100) > 1e-6) throw badRequest('Percentages must add up to 100.');
  }
  if (input.splitMethod === 'exact' && input.participants.some((p) => !Number.isSafeInteger(p.value ?? 0))) {
    throw badRequest('Each exact amount must be a valid amount.');
  }

  const shares = computeShares(input);
  const sum = shares.reduce((s, v) => s + v, 0);
  if (sum !== input.totalAmountMinor) {
    throw badRequest('The split must add up exactly to the total amount.');
  }
  if (shares.some((s) => s < 0)) throw badRequest('A share cannot be negative.');

  let mySplitMinor = 0;
  const memberShares: ExpensePlan['memberShares'] = [];
  input.participants.forEach((p, i) => {
    if (p.personId === null) mySplitMinor += shares[i]!;
    else if (shares[i]! > 0) memberShares.push({ personId: p.personId, amountMinor: shares[i]! });
  });

  // Your money is involved if you paid, or if you owe the payer a share.
  const touchesMyBooks = paidBy === null || mySplitMinor > 0;
  if (!touchesMyBooks) return { paidBy, mySplitMinor, memberShares, accountId: null };

  if (!input.accountId) throw badRequest('Choose the account for your part of this expense.');
  const account = await Account.findOne({ _id: visibleAccountIds(scope, input.accountId), workspaceId: scope.workspaceId, deletedAt: null }).lean();
  if (!account) throw notFound('Account');
  if (account.visibility === 'private' && String(account.userId) !== String(scope.userId)) {
    throw notFound('Account');
  }
  return { paidBy, mySplitMinor, memberShares, accountId: input.accountId };
}

/** Post the parts of an expense that belong in your own books (see the note at the top of this file). */
async function postExpenseTransactions(
  scope: RequestScope,
  plan: ExpensePlan,
  input: AddGroupExpenseInput,
  groupExpenseId: Types.ObjectId,
  audit: AuditContext,
  uow: UnitOfWork,
): Promise<Pick<IGroupExpense, 'myExpenseTransactionId' | 'myBorrowTransactionId' | 'memberShares'>> {
  const linked = { groupExpenseId: String(groupExpenseId) };
  let myExpenseTransactionId: Types.ObjectId | null = null;
  let myBorrowTransactionId: Types.ObjectId | null = null;

  if (plan.paidBy !== null && plan.mySplitMinor > 0) {
    // They paid; you owe them your share. Borrowed in, spent out — the account nets to zero.
    const borrow = await createTransaction(
      scope,
      { type: 'borrow', amountMinor: plan.mySplitMinor, date: input.date, accountId: plan.accountId!, personId: plan.paidBy, description: input.description, ...linked },
      audit,
      uow,
    );
    myBorrowTransactionId = borrow._id;
  }

  if (plan.mySplitMinor > 0) {
    const txn = await createTransaction(
      scope,
      {
        type: 'expense',
        amountMinor: plan.mySplitMinor,
        date: input.date,
        accountId: plan.accountId!,
        categoryId: input.categoryId ?? null,
        description: input.description,
        ...linked,
      },
      audit,
      uow,
    );
    myExpenseTransactionId = txn._id;
  }

  const memberShares: IGroupExpense['memberShares'] = [];
  for (const share of plan.memberShares) {
    let transactionId: Types.ObjectId | null = null;
    if (plan.paidBy === null) {
      const txn = await createTransaction(
        scope,
        { type: 'lend', amountMinor: share.amountMinor, date: input.date, accountId: plan.accountId!, personId: share.personId, description: input.description, ...linked },
        audit,
        uow,
      );
      transactionId = txn._id;
    }
    memberShares.push({ personId: new Types.ObjectId(share.personId), amountMinor: share.amountMinor, transactionId });
  }

  return { myExpenseTransactionId, myBorrowTransactionId, memberShares };
}

function linkedTransactionIds(expense: IGroupExpense): Types.ObjectId[] {
  return [expense.myBorrowTransactionId, expense.myExpenseTransactionId, ...expense.memberShares.map((s) => s.transactionId)].filter(
    (id): id is Types.ObjectId => Boolean(id),
  );
}

/** Remove an expense's transactions from your books, refusing (with a group-specific reason) if a payment was already set against one. */
async function removeExpenseTransactions(scope: RequestScope, expense: IGroupExpense, audit: AuditContext, uow: UnitOfWork): Promise<void> {
  for (const id of linkedTransactionIds(expense)) {
    const live = await Transaction.exists({ _id: id, deletedAt: null }).session(uow.session ?? null);
    if (!live) continue; // already removed from the transaction list itself
    try {
      await deleteTransaction(scope, String(id), audit, uow);
    } catch (err) {
      if (err instanceof AppError && err.code === 'HAS_REPAYMENTS') {
        throw conflict(
          'Money has already been settled against this expense. Delete the related group payment first, then change or remove it.',
          'GROUP_EXPENSE_SETTLED',
        );
      }
      throw err;
    }
  }
}

function splitInputsOf(input: AddGroupExpenseInput): IGroupExpense['splitInputs'] {
  return input.participants.map((p) => ({
    personId: p.personId ? new Types.ObjectId(p.personId) : null,
    value: input.splitMethod === 'equal' ? null : (p.value ?? 0),
  }));
}

export async function addGroupExpense(
  scope: RequestScope,
  groupId: string,
  input: AddGroupExpenseInput,
  audit: AuditContext,
): Promise<IGroupExpense> {
  const group = await getGroupDoc(scope, groupId);
  const plan = await planExpense(scope, group, input);

  return withTransaction(async (uow) => {
    const _id = new Types.ObjectId();
    const posted = await postExpenseTransactions(scope, plan, input, _id, audit, uow);

    const [expense] = await GroupExpense.create(
      [
        {
          _id,
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          groupId: group._id,
          description: input.description.trim(),
          date: input.date,
          totalAmountMinor: input.totalAmountMinor,
          accountId: plan.accountId,
          categoryId: plan.mySplitMinor > 0 ? (input.categoryId ?? null) : null,
          splitMethod: input.splitMethod,
          paidByPersonId: plan.paidBy,
          mySplitMinor: plan.mySplitMinor,
          splitInputs: splitInputsOf(input),
          ...posted,
        },
      ],
      { session: uow.session, ordered: true },
    );
    const groupExpenseDoc = expense!;
    uow.onRollback(async () => {
      await GroupExpense.deleteOne({ _id });
    });

    await recordAudit(audit, {
      action: 'created',
      entityType: 'GroupExpense',
      entityId: groupExpenseDoc._id,
      summary: `Added "${groupExpenseDoc.description}" to group expenses`,
    });

    return groupExpenseDoc;
  });
}

async function getExpenseDoc(scope: RequestScope, group: IExpenseGroup, expenseId: string, uow?: UnitOfWork): Promise<HydratedDocument<IGroupExpense>> {
  if (!Types.ObjectId.isValid(expenseId)) throw notFound('Group expense');
  const expense = await GroupExpense.findOne({ _id: expenseId, workspaceId: scope.workspaceId, groupId: group._id, deletedAt: null }).session(
    uow?.session ?? null,
  );
  if (!expense || (expense.accountId && scope.hiddenAccountIds.some((h) => h.equals(expense.accountId!)))) throw notFound('Group expense');
  return expense;
}

/** Same money, same people, same account: only the description, date or category is changing. */
function isDetailsOnlyEdit(expense: IGroupExpense, plan: ExpensePlan, input: AddGroupExpenseInput): boolean {
  const before = expense.memberShares.map((s) => `${String(s.personId)}:${s.amountMinor}`).sort().join(',');
  const after = plan.memberShares.map((s) => `${s.personId}:${s.amountMinor}`).sort().join(',');
  return (
    expense.totalAmountMinor === input.totalAmountMinor &&
    String(expense.paidByPersonId ?? '') === String(plan.paidBy ?? '') &&
    String(expense.accountId ?? '') === String(plan.accountId ?? '') &&
    expense.mySplitMinor === plan.mySplitMinor &&
    before === after
  );
}

/**
 * Edit an expense. If only its description, date or category changes, its
 * transactions are updated in place — which works even after payments have
 * been settled against it. Anything that changes the money replaces its
 * transactions atomically, which (like deleting) needs any payment already set
 * against them removed first.
 */
export async function updateGroupExpense(
  scope: RequestScope,
  groupId: string,
  expenseId: string,
  input: AddGroupExpenseInput,
  audit: AuditContext,
): Promise<IGroupExpense> {
  const group = await getGroupDoc(scope, groupId);
  const plan = await planExpense(scope, group, input);

  return withTransaction(async (uow) => {
    const expense = await getExpenseDoc(scope, group, expenseId, uow);
    // Raw, untransformed — the model's JSON transform would rename `_id`.
    const snapshot = expense.toObject({ transform: false, virtuals: false });
    const categoryId = plan.mySplitMinor > 0 ? (input.categoryId ?? null) : null;

    if (isDetailsOnlyEdit(expense, plan, input)) {
      for (const id of linkedTransactionIds(expense)) {
        const isMyExpense = expense.myExpenseTransactionId?.equals(id);
        await updateTransaction(
          scope,
          String(id),
          { description: input.description, date: input.date, ...(isMyExpense ? { categoryId } : {}) },
          audit,
          undefined,
          uow,
        );
      }
    } else {
      await removeExpenseTransactions(scope, expense, audit, uow);
      const posted = await postExpenseTransactions(scope, plan, input, expense._id, audit, uow);
      expense.set(posted);
    }

    expense.set({
      description: input.description.trim(),
      date: input.date,
      totalAmountMinor: input.totalAmountMinor,
      accountId: plan.accountId,
      categoryId,
      splitMethod: input.splitMethod,
      paidByPersonId: plan.paidBy,
      mySplitMinor: plan.mySplitMinor,
      splitInputs: splitInputsOf(input),
    });
    await expense.save({ session: uow.session });
    uow.onRollback(async () => {
      await GroupExpense.replaceOne({ _id: expense._id }, snapshot);
    });

    await recordAudit(audit, {
      action: 'updated',
      entityType: 'GroupExpense',
      entityId: expense._id,
      summary: `Edited "${expense.description}" in group expenses`,
    });

    return expense;
  });
}

export async function listGroupExpenses(scope: RequestScope, groupId: string): Promise<GroupExpenseDto[]> {
  const group = await getGroupDoc(scope, groupId);
  const expenses = await visibleExpenses(scope, group._id);
  if (expenses.length === 0) return [];

  const names = await nameMap(
    expenses.flatMap((e) => [...e.memberShares.map((s) => s.personId), ...(e.paidByPersonId ? [e.paidByPersonId] : [])]),
  );
  const accountIds = [...new Set(expenses.filter((e) => e.accountId).map((e) => String(e.accountId)))];
  const categoryIds = expenses.map((e) => e.categoryId).filter(Boolean) as Types.ObjectId[];
  const [accounts, categories] = await Promise.all([
    Account.find({ _id: { $in: accountIds } }).select('name').lean(),
    categoryIds.length ? Category.find({ _id: { $in: categoryIds } }).select('name').lean() : [],
  ]);
  const accountName = new Map(accounts.map((a) => [String(a._id), a.name]));
  const categoryName = new Map(categories.map((c) => [String(c._id), c.name]));

  return expenses.map((e) =>
    toGroupExpenseDto(
      e,
      names,
      e.accountId ? accountName.get(String(e.accountId)) : undefined,
      e.categoryId ? categoryName.get(String(e.categoryId)) : undefined,
    ),
  );
}

function visibleExpenses(scope: RequestScope, groupId: Types.ObjectId) {
  return GroupExpense.find({
    workspaceId: scope.workspaceId,
    groupId,
    deletedAt: null,
    // Paid from another member's private account: not theirs to see.
    ...(scope.hiddenAccountIds.length > 0 ? { accountId: { $nin: scope.hiddenAccountIds } } : {}),
  })
    .sort({ date: -1, createdAt: -1 })
    .lean();
}

function visibleSettlements(scope: RequestScope, groupId: Types.ObjectId) {
  return GroupSettlement.find({
    workspaceId: scope.workspaceId,
    groupId,
    deletedAt: null,
    ...(scope.hiddenAccountIds.length > 0 ? { accountId: { $nin: scope.hiddenAccountIds } } : {}),
  })
    .sort({ date: -1, createdAt: -1 })
    .lean();
}

export async function deleteGroupExpense(scope: RequestScope, groupId: string, expenseId: string, audit: AuditContext): Promise<void> {
  const group = await getGroupDoc(scope, groupId);

  await withTransaction(async (uow) => {
    const expense = await getExpenseDoc(scope, group, expenseId, uow);
    await removeExpenseTransactions(scope, expense, audit, uow);

    expense.deletedAt = new Date();
    await expense.save({ session: uow.session });
    uow.onRollback(async () => {
      await GroupExpense.updateOne({ _id: expense._id }, { $set: { deletedAt: null } });
    });

    await recordAudit(audit, {
      action: 'deleted',
      entityType: 'GroupExpense',
      entityId: expense._id,
      summary: `Removed "${expense.description}" from group expenses`,
    });
  });
}

/** Each member's outstanding balance across the group — straight from the real `lend` transactions, never a second total. */
export async function getGroupBalances(scope: RequestScope, groupId: string): Promise<GroupMemberBalanceDto[]> {
  const group = await getGroupDoc(scope, groupId);
  const names = await nameMap(group.memberPersonIds);

  const expenses = await GroupExpense.find({ workspaceId: scope.workspaceId, groupId: group._id, deletedAt: null })
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

// ─────────────────────────────────────────────── Balances & settling up

const idOrNull = (id: Types.ObjectId | null | undefined) => (id ? String(id) : null);

function toLedger(expenses: IGroupExpense[], settlements: IGroupSettlement[]) {
  const ledgerExpenses: GroupLedgerExpense[] = expenses.map((e) => ({
    paidBy: idOrNull(e.paidByPersonId),
    totalAmountMinor: e.totalAmountMinor,
    shares: [
      ...(e.mySplitMinor > 0 ? [{ memberId: null, amountMinor: e.mySplitMinor }] : []),
      ...e.memberShares.map((s) => ({ memberId: String(s.personId), amountMinor: s.amountMinor })),
    ],
  }));
  const ledgerSettlements: GroupLedgerSettlement[] = settlements.map((s) => ({
    from: idOrNull(s.fromPersonId),
    to: idOrNull(s.toPersonId),
    amountMinor: s.amountMinor,
  }));
  return { ledgerExpenses, ledgerSettlements };
}

async function computeBalances(scope: RequestScope, group: IExpenseGroup) {
  const [expenses, settlements] = await Promise.all([visibleExpenses(scope, group._id), visibleSettlements(scope, group._id)]);
  const { ledgerExpenses, ledgerSettlements } = toLedger(expenses, settlements);
  const positions = computeGroupPositions([null, ...group.memberPersonIds.map(String)], ledgerExpenses, ledgerSettlements);
  const direct = computeDirectBalances(ledgerExpenses, ledgerSettlements);
  return { expenses, settlements, positions, direct };
}

function toSettlementDto(s: IGroupSettlement, names: Map<string, string>, accountName?: string): GroupSettlementDto {
  return {
    id: String(s._id),
    groupId: String(s.groupId),
    fromPersonId: idOrNull(s.fromPersonId),
    toPersonId: idOrNull(s.toPersonId),
    fromName: s.fromPersonId ? names.get(String(s.fromPersonId)) : undefined,
    toName: s.toPersonId ? names.get(String(s.toPersonId)) : undefined,
    amountMinor: s.amountMinor,
    date: s.date.toISOString(),
    accountId: s.accountId ? String(s.accountId) : undefined,
    accountName,
    transactionId: s.transactionId ? String(s.transactionId) : undefined,
    note: s.note,
    createdAt: s.createdAt.toISOString(),
  };
}

export async function getGroupSummary(scope: RequestScope, groupId: string): Promise<GroupSummaryDto> {
  const group = await getGroupDoc(scope, groupId);
  const { expenses, settlements, positions, direct } = await computeBalances(scope, group);

  const personIds = [
    ...group.memberPersonIds,
    ...settlements.flatMap((s) => [s.fromPersonId, s.toPersonId]).filter((id): id is Types.ObjectId => Boolean(id)),
  ];
  const names = await nameMap(personIds);
  const nameOf = (id: string | null) => (id ? names.get(id) : undefined);

  const accountIds = settlements.map((s) => s.accountId).filter((id): id is Types.ObjectId => Boolean(id));
  const accounts = accountIds.length ? await Account.find({ _id: { $in: accountIds } }).select('name').lean() : [];
  const accountName = new Map(accounts.map((a) => [String(a._id), a.name]));

  return {
    totalSpentMinor: expenses.reduce((sum, e) => sum + e.totalAmountMinor, 0),
    expenseCount: expenses.length,
    positions: positions.map((p) => ({
      personId: p.memberId,
      personName: nameOf(p.memberId),
      paidMinor: p.paidMinor,
      shareMinor: p.shareMinor,
      sentMinor: p.sentMinor,
      receivedMinor: p.receivedMinor,
      netMinor: p.netMinor,
    })),
    suggestions: suggestGroupSettlements(positions, direct).map((s) => ({
      fromPersonId: s.from,
      toPersonId: s.to,
      fromName: nameOf(s.from),
      toName: nameOf(s.to),
      amountMinor: s.amountMinor,
    })),
    settlements: settlements.map((s) => toSettlementDto(s, names, s.accountId ? accountName.get(String(s.accountId)) : undefined)),
  };
}

export interface RecordSettlementInput {
  /** `null` is you. */
  fromPersonId: string | null;
  toPersonId: string | null;
  amountMinor: number;
  date: Date;
  /** Required when you are paying or being paid. */
  accountId?: string | null;
  note?: string;
}

/**
 * Record a payment between two members — the whole amount owed, or part of it.
 * When you are one of the two it is also an ordinary repayment in your books,
 * against that person; a payment between two other members is the group's
 * record alone.
 */
export async function recordGroupSettlement(
  scope: RequestScope,
  groupId: string,
  input: RecordSettlementInput,
  audit: AuditContext,
): Promise<GroupSettlementDto> {
  const group = await getGroupDoc(scope, groupId);
  const from = input.fromPersonId ?? null;
  const to = input.toPersonId ?? null;
  if (from === to) throw badRequest('Choose two different people for a payment.');
  const memberIds = new Set(group.memberPersonIds.map(String));
  if ((from !== null && !memberIds.has(from)) || (to !== null && !memberIds.has(to))) {
    throw badRequest('Both people in a payment must be members of this group.');
  }

  const { positions, direct } = await computeBalances(scope, group);
  if (from === null) {
    if (input.amountMinor > -(direct.get(to!) ?? 0)) throw badRequest('That is more than you owe them in this group.');
  } else if (to === null) {
    if (input.amountMinor > (direct.get(from) ?? 0)) throw badRequest('That is more than they owe you in this group.');
  } else {
    const residualOf = (id: string) => residualBalance(positions.find((p) => p.memberId === id)!, direct);
    if (input.amountMinor > Math.min(-residualOf(from), residualOf(to))) {
      throw badRequest('That is more than is owed between these two members.');
    }
  }

  const involvesMe = from === null || to === null;
  if (involvesMe && !input.accountId) throw badRequest('Choose the account the money moved through.');

  const settlement = await withTransaction(async (uow) => {
    let transactionId: Types.ObjectId | null = null;
    if (involvesMe) {
      const txn = await createTransaction(
        scope,
        {
          type: from === null ? 'repayment_given' : 'repayment_received',
          amountMinor: input.amountMinor,
          date: input.date,
          accountId: input.accountId!,
          personId: from ?? to!,
          description: input.note?.trim() || `Settle up · ${group.name}`,
        },
        audit,
        uow,
      );
      transactionId = txn._id;
    }

    const [created] = await GroupSettlement.create(
      [
        {
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          groupId: group._id,
          fromPersonId: from,
          toPersonId: to,
          amountMinor: input.amountMinor,
          date: input.date,
          accountId: involvesMe ? input.accountId : null,
          transactionId,
          note: input.note?.trim() ?? '',
        },
      ],
      { session: uow.session, ordered: true },
    );
    const doc = created!;
    uow.onRollback(async () => {
      await GroupSettlement.deleteOne({ _id: doc._id });
    });

    await recordAudit(audit, {
      action: 'created',
      entityType: 'GroupSettlement',
      entityId: doc._id,
      summary: `Recorded a payment in group "${group.name}"`,
    });
    return doc;
  });

  const names = await nameMap([from, to].filter((id): id is string => Boolean(id)).map((id) => new Types.ObjectId(id)));
  const account = settlement.accountId ? await Account.findById(settlement.accountId).select('name').lean() : null;
  return toSettlementDto(settlement, names, account?.name);
}

/** Undo a recorded payment — including its repayment in your books, if you were part of it. */
export async function deleteGroupSettlement(scope: RequestScope, groupId: string, settlementId: string, audit: AuditContext): Promise<void> {
  const group = await getGroupDoc(scope, groupId);
  if (!Types.ObjectId.isValid(settlementId)) throw notFound('Group payment');

  await withTransaction(async (uow) => {
    const settlement = await GroupSettlement.findOne({ _id: settlementId, workspaceId: scope.workspaceId, groupId: group._id, deletedAt: null }).session(
      uow.session ?? null,
    );
    if (!settlement || (settlement.accountId && scope.hiddenAccountIds.some((h) => h.equals(settlement.accountId!)))) {
      throw notFound('Group payment');
    }

    if (settlement.transactionId && (await Transaction.exists({ _id: settlement.transactionId, deletedAt: null }).session(uow.session ?? null))) {
      await deleteTransaction(scope, String(settlement.transactionId), audit, uow);
    }

    settlement.deletedAt = new Date();
    await settlement.save({ session: uow.session });
    uow.onRollback(async () => {
      await GroupSettlement.updateOne({ _id: settlement._id }, { $set: { deletedAt: null } });
    });

    await recordAudit(audit, {
      action: 'deleted',
      entityType: 'GroupSettlement',
      entityId: settlement._id,
      summary: `Removed a payment from group "${group.name}"`,
    });
  });
}
