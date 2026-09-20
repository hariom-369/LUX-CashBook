import { Types, type HydratedDocument } from 'mongoose';
import { diffInDays, safePercent, type GoalProgressDto, type SavingsGoalDto } from '@khata/shared';
import { Account, SavingsGoal, type ISavingsGoal } from '../../models/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';

export type GoalDoc = HydratedDocument<ISavingsGoal>;

function contributedOf(goal: ISavingsGoal): number {
  return goal.contributions.reduce((sum, c) => sum + c.amountMinor, 0);
}

export function toGoalDto(goal: ISavingsGoal, linkedAccountBalanceMinor?: number): SavingsGoalDto {
  const currentMinor = goal.linkedAccountId ? (linkedAccountBalanceMinor ?? 0) : contributedOf(goal);
  return {
    id: String(goal._id),
    workspaceId: String(goal.workspaceId),
    name: goal.name,
    targetMinor: goal.targetMinor,
    currentMinor,
    targetDate: goal.targetDate?.toISOString(),
    icon: goal.icon,
    color: goal.color,
    linkedAccountId: goal.linkedAccountId ? String(goal.linkedAccountId) : undefined,
    notes: goal.notes,
    isAchieved: goal.isAchieved,
    achievedAt: goal.achievedAt?.toISOString(),
    createdAt: goal.createdAt.toISOString(),
  };
}

function toProgressDto(dto: SavingsGoalDto, now: Date): GoalProgressDto {
  const percentComplete = Math.min(100, safePercent(dto.currentMinor, dto.targetMinor));
  const remainingMinor = Math.max(0, dto.targetMinor - dto.currentMinor);
  const daysRemaining = dto.targetDate ? Math.max(0, diffInDays(new Date(dto.targetDate), now)) : undefined;
  const monthsRemaining = daysRemaining !== undefined ? Math.max(1, Math.ceil(daysRemaining / 30)) : undefined;

  return {
    ...dto,
    percentComplete,
    remainingMinor,
    daysRemaining,
    requiredMonthlyMinor: monthsRemaining ? Math.ceil(remainingMinor / monthsRemaining) : undefined,
  };
}

export interface CreateGoalInput {
  name: string;
  targetMinor: number;
  targetDate?: Date | null;
  icon?: string;
  color?: string;
  linkedAccountId?: string | null;
  notes?: string;
}

export async function listGoals(scope: RequestScope, now: Date = new Date()): Promise<GoalProgressDto[]> {
  const goals = await SavingsGoal.find({ workspaceId: scope.workspaceId, isArchived: false })
    .sort({ isAchieved: 1, sortOrder: 1, createdAt: 1 })
    .lean();

  const accountIds = goals.map((g) => g.linkedAccountId).filter(Boolean) as Types.ObjectId[];
  const accounts = accountIds.length
    ? await Account.find({ _id: { $in: accountIds } }).select('cachedBalanceMinor').lean()
    : [];
  const balanceById = new Map(accounts.map((a) => [String(a._id), a.cachedBalanceMinor]));

  return goals.map((goal) =>
    toProgressDto(
      toGoalDto(goal, goal.linkedAccountId ? balanceById.get(String(goal.linkedAccountId)) : undefined),
      now,
    ),
  );
}

async function getGoalDoc(scope: RequestScope, goalId: string): Promise<GoalDoc> {
  if (!Types.ObjectId.isValid(goalId)) throw notFound('Goal');
  const goal = await SavingsGoal.findOne({ _id: goalId, workspaceId: scope.workspaceId });
  if (!goal) throw notFound('Goal');
  return goal;
}

export async function createGoal(scope: RequestScope, input: CreateGoalInput, audit: AuditContext): Promise<GoalDoc> {
  if (input.linkedAccountId && !Types.ObjectId.isValid(input.linkedAccountId)) throw notFound('Account');
  if (input.linkedAccountId) {
    const account = await Account.findOne({ _id: input.linkedAccountId, workspaceId: scope.workspaceId }).lean();
    if (!account) throw notFound('Account');
  }

  const goal = await SavingsGoal.create({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    name: input.name.trim(),
    targetMinor: input.targetMinor,
    targetDate: input.targetDate ?? null,
    icon: input.icon ?? 'Target',
    color: input.color ?? '#B08D4F',
    linkedAccountId: input.linkedAccountId ?? null,
    notes: input.notes,
  });

  await recordAudit(audit, {
    action: 'created',
    entityType: 'SavingsGoal',
    entityId: goal._id,
    summary: `Created goal "${goal.name}"`,
  });

  return goal;
}

export async function updateGoal(
  scope: RequestScope,
  goalId: string,
  input: Partial<CreateGoalInput> & { isArchived?: boolean },
  audit: AuditContext,
): Promise<GoalDoc> {
  const goal = await getGoalDoc(scope, goalId);

  for (const key of ['name', 'targetMinor', 'targetDate', 'icon', 'color', 'notes', 'isArchived'] as const) {
    if (input[key] !== undefined) (goal as unknown as Record<string, unknown>)[key] = input[key];
  }
  if (input.linkedAccountId !== undefined) {
    goal.linkedAccountId = input.linkedAccountId ? new Types.ObjectId(input.linkedAccountId) : null;
  }

  await goal.save();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'SavingsGoal',
    entityId: goal._id,
    summary: `Updated goal "${goal.name}"`,
  });

  return goal;
}

export async function deleteGoal(scope: RequestScope, goalId: string, audit: AuditContext): Promise<void> {
  const goal = await getGoalDoc(scope, goalId);
  await goal.deleteOne();

  await recordAudit(audit, {
    action: 'deleted',
    entityType: 'SavingsGoal',
    entityId: goal._id,
    summary: `Deleted goal "${goal.name}"`,
  });
}

/**
 * Add a manual contribution (§30).
 *
 * Only valid for a goal that is not tracking a linked account — an account-linked
 * goal's progress is the account balance itself, so a manual contribution there
 * would double-count. Crossing the target here marks the goal achieved and raises
 * a celebratory notification (§41).
 */
export async function addContribution(
  scope: RequestScope,
  goalId: string,
  input: { amountMinor: number; date?: Date; note?: string },
  audit: AuditContext,
): Promise<GoalDoc> {
  const goal = await getGoalDoc(scope, goalId);
  if (goal.linkedAccountId) {
    throw badRequest('This goal tracks an account balance automatically — contributions are not needed.');
  }

  goal.contributions.push({
    _id: new Types.ObjectId(),
    amountMinor: input.amountMinor,
    date: input.date ?? new Date(),
    note: input.note,
  });

  const total = contributedOf(goal);
  const justAchieved = !goal.isAchieved && total >= goal.targetMinor;
  if (justAchieved) {
    goal.isAchieved = true;
    goal.achievedAt = new Date();
  }

  await goal.save();

  if (justAchieved) {
    const { Notification } = await import('../../models/index.js');
    await Notification.create({
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      type: 'goal_reached',
      title: `Goal reached: ${goal.name}`,
      body: `You've hit your target. Well done.`,
      icon: 'PartyPopper',
      link: '/goals',
    }).catch(() => undefined);
  }

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'SavingsGoal',
    entityId: goal._id,
    summary: `Added a contribution to "${goal.name}"`,
  });

  return goal;
}

export async function removeContribution(
  scope: RequestScope,
  goalId: string,
  contributionId: string,
  audit: AuditContext,
): Promise<GoalDoc> {
  const goal = await getGoalDoc(scope, goalId);
  const before = goal.contributions.length;
  goal.contributions = goal.contributions.filter((c) => String(c._id) !== contributionId) as typeof goal.contributions;
  if (goal.contributions.length === before) throw notFound('Contribution');

  const total = contributedOf(goal);
  if (goal.isAchieved && total < goal.targetMinor) {
    goal.isAchieved = false;
    goal.achievedAt = null;
  }

  await goal.save();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'SavingsGoal',
    entityId: goal._id,
    summary: `Removed a contribution from "${goal.name}"`,
  });

  return goal;
}
