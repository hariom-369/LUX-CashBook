import { Types, type HydratedDocument } from 'mongoose';
import { addDays, endOfDay, type ReminderDto, type ReminderType } from '@khata/shared';
import { Person, Reminder, Transaction, type IReminder } from '../../models/index.js';
import { notFound } from '../../lib/errors.js';
import type { RequestScope } from '../../middleware/context.js';
import { recordAudit, type AuditContext } from '../../services/audit.service.js';

export type ReminderDoc = HydratedDocument<IReminder>;

export function toReminderDto(reminder: IReminder, personName?: string): ReminderDto {
  return {
    id: String(reminder._id),
    workspaceId: String(reminder.workspaceId),
    type: reminder.type,
    title: reminder.title,
    amountMinor: reminder.amountMinor,
    dueDate: reminder.dueDate.toISOString(),
    personId: reminder.personId ? String(reminder.personId) : undefined,
    personName,
    transactionId: reminder.transactionId ? String(reminder.transactionId) : undefined,
    recurringId: reminder.recurringId ? String(reminder.recurringId) : undefined,
    notes: reminder.notes,
    isDone: reminder.isDone,
    completedAt: reminder.completedAt?.toISOString(),
    notifyDaysBefore: reminder.notifyDaysBefore,
  };
}

export interface CreateReminderInput {
  type: ReminderType;
  title: string;
  amountMinor?: number;
  dueDate: Date;
  personId?: string | null;
  notes?: string;
  notifyDaysBefore?: number;
}

export async function listReminders(
  scope: RequestScope,
  options: { includeDone?: boolean } = {},
): Promise<ReminderDto[]> {
  const filter: Record<string, unknown> = { workspaceId: scope.workspaceId };
  if (!options.includeDone) filter.isDone = false;

  const reminders = await Reminder.find(filter).sort({ dueDate: 1 }).lean();
  const personIds = reminders.map((r) => r.personId).filter(Boolean) as Types.ObjectId[];
  const people = personIds.length
    ? await Person.find({ _id: { $in: personIds } }).select('name').lean()
    : [];
  const nameById = new Map(people.map((p) => [String(p._id), p.name]));

  return reminders.map((r) => toReminderDto(r, r.personId ? nameById.get(String(r.personId)) : undefined));
}

export async function createReminder(
  scope: RequestScope,
  input: CreateReminderInput,
  audit: AuditContext,
): Promise<ReminderDoc> {
  const reminder = await Reminder.create({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    type: input.type,
    title: input.title.trim(),
    amountMinor: input.amountMinor,
    dueDate: input.dueDate,
    personId: input.personId,
    notes: input.notes,
    notifyDaysBefore: input.notifyDaysBefore ?? 1,
  });

  await recordAudit(audit, {
    action: 'created',
    entityType: 'Reminder',
    entityId: reminder._id,
    summary: `Created reminder "${reminder.title}"`,
  });

  return reminder;
}

async function getReminderDoc(scope: RequestScope, id: string): Promise<ReminderDoc> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Reminder');
  const reminder = await Reminder.findOne({ _id: id, workspaceId: scope.workspaceId });
  if (!reminder) throw notFound('Reminder');
  return reminder;
}

export async function updateReminder(
  scope: RequestScope,
  id: string,
  input: Partial<CreateReminderInput>,
  audit: AuditContext,
): Promise<ReminderDoc> {
  const reminder = await getReminderDoc(scope, id);
  for (const key of ['type', 'title', 'amountMinor', 'dueDate', 'personId', 'notes', 'notifyDaysBefore'] as const) {
    if (input[key] !== undefined) (reminder as unknown as Record<string, unknown>)[key] = input[key];
  }
  await reminder.save();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'Reminder',
    entityId: reminder._id,
    summary: `Updated reminder "${reminder.title}"`,
  });

  return reminder;
}

export async function completeReminder(scope: RequestScope, id: string, audit: AuditContext): Promise<ReminderDoc> {
  const reminder = await getReminderDoc(scope, id);
  reminder.isDone = true;
  reminder.completedAt = new Date();
  await reminder.save();

  await recordAudit(audit, {
    action: 'updated',
    entityType: 'Reminder',
    entityId: reminder._id,
    summary: `Completed reminder "${reminder.title}"`,
  });

  return reminder;
}

export async function deleteReminder(scope: RequestScope, id: string, audit: AuditContext): Promise<void> {
  const reminder = await getReminderDoc(scope, id);
  await reminder.deleteOne();

  await recordAudit(audit, {
    action: 'deleted',
    entityType: 'Reminder',
    entityId: reminder._id,
    summary: `Deleted reminder "${reminder.title}"`,
  });
}

/**
 * Keep the loan-due reminders in sync with the ledger (§18).
 *
 * A reminder for a loan is *derived*, not owned by the user: it should exist for
 * exactly as long as the loan has a due date and remains outstanding, and vanish
 * the moment it's settled. Rather than trying to update one in place through every
 * possible edit, this recomputes the set on every call — upserting the current ones
 * by a stable `sourceKey` and removing any that no longer apply. Idempotent, and
 * safe to call as often as the scheduler likes.
 */
export async function syncLoanReminders(scope: RequestScope): Promise<void> {
  const outstandingLoans = await Transaction.find({
    workspaceId: scope.workspaceId,
    deletedAt: null,
    type: { $in: ['lend', 'borrow'] },
    dueDate: { $ne: null },
    $expr: { $lt: ['$settledMinor', '$amountMinor'] },
  })
    .select('type amountMinor settledMinor dueDate personId')
    .lean();

  const personIds = outstandingLoans.map((l) => l.personId).filter(Boolean) as Types.ObjectId[];
  const people = personIds.length
    ? await Person.find({ _id: { $in: personIds } }).select('name').lean()
    : [];
  const nameById = new Map(people.map((p) => [String(p._id), p.name]));

  const liveKeys = new Set<string>();

  for (const loan of outstandingLoans) {
    const sourceKey = `loan:${loan._id}`;
    liveKeys.add(sourceKey);
    const name = loan.personId ? (nameById.get(String(loan.personId)) ?? 'Someone') : 'Someone';
    const outstanding = loan.amountMinor - loan.settledMinor;

    await Reminder.updateOne(
      { workspaceId: scope.workspaceId, sourceKey },
      {
        $set: {
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          type: 'loan_due',
          title: loan.type === 'lend' ? `${name} owes you` : `You owe ${name}`,
          amountMinor: outstanding,
          dueDate: loan.dueDate,
          personId: loan.personId,
          transactionId: loan._id,
          sourceKey,
          isDone: false,
        },
      },
      { upsert: true },
    );
  }

  // Retire generated reminders for loans that are now settled, deleted, or lost
  // their due date — a stale "loan due" reminder is worse than none.
  await Reminder.deleteMany({
    workspaceId: scope.workspaceId,
    sourceKey: { $regex: /^loan:/, $nin: [...liveKeys] },
  });
}

/**
 * Notify on reminders due soon that haven't been announced yet (§18, §41).
 * Called by the scheduler; safe to call repeatedly thanks to `lastNotifiedAt`.
 */
export async function raiseDueReminderNotifications(now: Date = new Date()): Promise<number> {
  const horizon = endOfDay(addDays(now, 7));
  const due = await Reminder.find({
    isDone: false,
    isDismissed: false,
    dueDate: { $lte: horizon },
    $or: [{ lastNotifiedAt: null }, { lastNotifiedAt: { $lt: addDays(now, -1) } }],
  }).limit(500);

  if (due.length === 0) return 0;

  const { Notification } = await import('../../models/index.js');
  const { formatMoney } = await import('@khata/shared');

  let raised = 0;
  for (const reminder of due) {
    const daysUntil = Math.round((reminder.dueDate.getTime() - now.getTime()) / 86_400_000);
    if (daysUntil > reminder.notifyDaysBefore) continue;

    const overdue = daysUntil < 0;
    const dedupeKey = `reminder:${reminder._id}:${now.toISOString().slice(0, 10)}`;

    await Notification.updateOne(
      { userId: reminder.userId, dedupeKey },
      {
        $setOnInsert: {
          userId: reminder.userId,
          workspaceId: reminder.workspaceId,
          type: reminder.type === 'loan_due' ? 'money_due' : 'money_due',
          title: overdue ? `Overdue: ${reminder.title}` : reminder.title,
          body: reminder.amountMinor
            ? `${formatMoney(reminder.amountMinor, { compactDecimals: true })}${overdue ? ' is overdue.' : ` due ${daysUntil === 0 ? 'today' : `in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`}.`}`
            : overdue
              ? 'This is overdue.'
              : 'Coming up soon.',
          icon: 'Bell',
          link: '/reports',
          amountMinor: reminder.amountMinor,
          dedupeKey,
        },
      },
      { upsert: true },
    );

    reminder.lastNotifiedAt = now;
    await reminder.save();
    raised++;
  }

  return raised;
}
