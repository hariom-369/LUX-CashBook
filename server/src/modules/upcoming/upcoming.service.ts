import { Types } from 'mongoose';
import {
  TRANSACTION_META,
  addDays,
  endOfDay,
  startOfDay,
  toDateKey,
  type UpcomingPaymentDto,
  type UpcomingPaymentsDto,
  type UpcomingPaymentStatus,
} from '@khata/shared';
import { Account, InstallmentPlan, Payee, Person, RecurringTransaction, Reminder, Transaction } from '../../models/index.js';
import type { RequestScope } from '../../middleware/context.js';
import { excludeHiddenTransactions } from '../../services/accountVisibility.js';
import { computeNextRun } from '../recurring/recurring.service.js';

/**
 * Unified upcoming payments: one timeline of everything scheduled — recurring entries and bills,
 * loan due dates and installments, card due dates and your own reminders — plus what was paid
 * recently, kept visibly separate.
 *
 * Read-only by construction. Every item is computed on request from the records it comes from,
 * so an edit, pause, cancellation or payment shows up the moment it happens, and displaying the
 * timeline never creates, posts or changes anything. Each item's `key` is derived from its source
 * and date, so the same obligation can never appear twice.
 *
 * Sources and how duplicates are avoided:
 *  - recurring: future occurrences projected from the entry's own schedule (`computeNextRun`, the
 *    same function the scheduler posts with). Paused, inactive and trashed entries are left out.
 *  - loans: a lend/borrow with a due date and money still outstanding. A loan with an installment
 *    plan is shown as its installments instead, never both.
 *  - reminders: your own reminders and card due dates. Reminders generated from loans and
 *    installments are skipped (the loan itself is the source), as are document-expiry reminders,
 *    which are not payments.
 *
 * Dates are calendar days in the server's time zone, the same as every other date in the app.
 */

const MAX_OCCURRENCES_PER_ENTRY = 100;
const MAX_ITEMS = 500;

export interface UpcomingOptions {
  /** How far ahead to look, in days from today. */
  days: number;
  /** How far back to show completed payments, in days. */
  paidDays: number;
}

function statusFor(due: Date, today: Date, paid: boolean): UpcomingPaymentStatus {
  if (paid) return 'paid';
  if (due < today) return 'overdue';
  if (toDateKey(due) === toDateKey(today)) return 'due_today';
  return 'upcoming';
}

function directionFor(type: string): UpcomingPaymentDto['direction'] {
  const meta = TRANSACTION_META[type as keyof typeof TRANSACTION_META];
  if (!meta || meta.isTransfer) return 'neutral';
  return meta.direction === 'in' ? 'in' : 'out';
}

export async function getUpcomingPayments(scope: RequestScope, options: UpcomingOptions, now: Date = new Date()): Promise<UpcomingPaymentsDto> {
  const today = startOfDay(now);
  const horizon = endOfDay(addDays(today, options.days));
  const paidFrom = startOfDay(addDays(today, -options.paidDays));
  const hidden = scope.hiddenAccountIds;
  const items: UpcomingPaymentDto[] = [];

  // ── Recurring entries and bills ────────────────────────────────────────────
  const recurring = await RecurringTransaction.find({
    workspaceId: scope.workspaceId,
    isActive: true,
    isPaused: false,
    deletedAt: null,
    nextRunDate: { $lte: horizon },
    ...(hidden.length ? { accountId: { $nin: hidden }, toAccountId: { $nin: hidden } } : {}),
  }).lean();

  const names = await lookupNames(
    recurring.flatMap((r) => [r.accountId]),
    recurring.map((r) => r.payeeId).filter((id): id is Types.ObjectId => Boolean(id)),
    recurring.map((r) => r.personId).filter((id): id is Types.ObjectId => Boolean(id)),
  );

  for (const entry of recurring) {
    let due = new Date(entry.nextRunDate);
    for (let n = 0; n < MAX_OCCURRENCES_PER_ENTRY && due <= horizon; n++) {
      if (entry.endDate && due > endOfDay(entry.endDate)) break;
      if (entry.maxOccurrences && entry.occurrencesCreated + n >= entry.maxOccurrences) break;
      items.push({
        key: `recurring:${entry._id}:${toDateKey(due)}`,
        source: 'recurring',
        sourceId: String(entry._id),
        title: entry.name,
        amountMinor: entry.amountMinor,
        direction: directionFor(entry.type),
        dueDate: due.toISOString(),
        dateKey: toDateKey(due),
        status: statusFor(due, today, false),
        autoPost: entry.autoPost,
        billKind: entry.billKind ?? undefined,
        accountName: names.account.get(String(entry.accountId)),
        counterparty: entry.payeeId ? names.payee.get(String(entry.payeeId)) : entry.personId ? names.person.get(String(entry.personId)) : undefined,
        link: entry.billKind ? '/bills' : '/recurring',
      });
      due = computeNextRun(entry, due);
    }
  }

  // Recurring payments already made in the look-back window — completed, never "due".
  const posted = await Transaction.find({
    workspaceId: scope.workspaceId,
    deletedAt: null,
    isRecurringInstance: true,
    recurringId: { $ne: null },
    date: { $gte: paidFrom, $lte: horizon },
    ...excludeHiddenTransactions(scope),
  })
    .select('recurringId amountMinor type date description postings')
    .lean();
  const templateNames = new Map(
    (await RecurringTransaction.find({ _id: { $in: posted.map((p) => p.recurringId) } }).select('name billKind').lean()).map((r) => [String(r._id), r]),
  );
  for (const txn of posted) {
    const template = templateNames.get(String(txn.recurringId));
    items.push({
      key: `paid:${txn._id}`,
      source: 'recurring',
      sourceId: String(txn.recurringId),
      title: template?.name ?? txn.description,
      amountMinor: txn.amountMinor,
      direction: directionFor(txn.type),
      dueDate: txn.date.toISOString(),
      dateKey: toDateKey(txn.date),
      status: 'paid',
      billKind: template?.billKind ?? undefined,
      transactionId: String(txn._id),
      link: `/transactions?q=${encodeURIComponent(txn.description || template?.name || '')}`,
    });
  }

  // ── Loans and installments ─────────────────────────────────────────────────
  const loans = await Transaction.find({
    workspaceId: scope.workspaceId,
    deletedAt: null,
    type: { $in: ['lend', 'borrow'] },
    ...excludeHiddenTransactions(scope),
    $or: [{ dueDate: { $ne: null, $lte: horizon } }, { _id: { $in: await InstallmentPlan.distinct('transactionId', { workspaceId: scope.workspaceId }) } }],
  })
    .select('type amountMinor settledMinor dueDate personId description')
    .lean();
  const plans = new Map(
    (await InstallmentPlan.find({ workspaceId: scope.workspaceId, transactionId: { $in: loans.map((l) => l._id) } }).lean()).map((p) => [String(p.transactionId), p]),
  );
  const people = (await lookupNames([], [], loans.map((l) => l.personId).filter((id): id is Types.ObjectId => Boolean(id)))).person;

  for (const loan of loans) {
    const receivable = loan.type === 'lend';
    const who = loan.personId ? people.get(String(loan.personId)) : undefined;
    const plan = plans.get(String(loan._id));

    if (plan) {
      // Installments are paid off in order from what has been repaid so far — the same rule as
      // the loan's own schedule screen.
      let cumulative = 0;
      for (const installment of [...plan.installments].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())) {
        cumulative += installment.amountMinor;
        const remaining = Math.min(installment.amountMinor, Math.max(0, cumulative - loan.settledMinor));
        const paid = remaining === 0;
        const due = installment.dueDate;
        if (due > horizon || (paid && due < paidFrom)) continue;
        items.push({
          key: `installment:${loan._id}:${toDateKey(due)}`,
          source: 'installment',
          sourceId: String(loan._id),
          title: loan.description || '',
          amountMinor: paid ? installment.amountMinor : remaining,
          direction: receivable ? 'in' : 'out',
          dueDate: due.toISOString(),
          dateKey: toDateKey(due),
          status: statusFor(due, today, paid),
          counterparty: who,
          link: loan.personId ? `/people/${loan.personId}` : '/people',
        });
      }
      continue;
    }

    if (!loan.dueDate) continue;
    const outstanding = Math.max(0, loan.amountMinor - loan.settledMinor);
    const paid = outstanding === 0;
    if (paid && loan.dueDate < paidFrom) continue;
    items.push({
      key: `loan:${loan._id}:${toDateKey(loan.dueDate)}`,
      source: 'loan',
      sourceId: String(loan._id),
      title: loan.description || '',
      amountMinor: paid ? loan.amountMinor : outstanding,
      direction: receivable ? 'in' : 'out',
      dueDate: loan.dueDate.toISOString(),
      dateKey: toDateKey(loan.dueDate),
      status: statusFor(loan.dueDate, today, paid),
      counterparty: who,
      link: loan.personId ? `/people/${loan.personId}` : '/people',
    });
  }

  // ── Reminders: your own, and card due dates ────────────────────────────────
  const reminders = await Reminder.find({
    workspaceId: scope.workspaceId,
    deletedAt: null,
    isDismissed: false,
    type: { $ne: 'document_expiry' },
    $and: [
      { $or: [{ sourceKey: null }, { sourceKey: { $regex: /^card:/ } }] },
      { $or: [{ isDone: false, dueDate: { $lte: horizon } }, { isDone: true, dueDate: { $gte: paidFrom, $lte: horizon } }] },
    ],
  }).lean();

  for (const reminder of reminders) {
    if (reminder.sourceKey?.startsWith('card:')) {
      const cardId = reminder.sourceKey.split(':')[1];
      if (cardId && hidden.some((h) => String(h) === cardId)) continue; // another member's private card
    }
    items.push({
      key: `reminder:${reminder._id}`,
      source: reminder.sourceKey ? 'card' : 'reminder',
      sourceId: String(reminder._id),
      title: reminder.title,
      amountMinor: reminder.amountMinor ?? null,
      direction: reminder.type === 'receivable' ? 'in' : 'out',
      dueDate: reminder.dueDate.toISOString(),
      dateKey: toDateKey(reminder.dueDate),
      status: statusFor(reminder.dueDate, today, reminder.isDone),
      link: '/calendar',
    });
  }

  // Overdue first, then by date; completed payments after everything still to pay.
  const order: Record<UpcomingPaymentStatus, number> = { overdue: 0, due_today: 1, upcoming: 2, paid: 3 };
  items.sort((a, b) => order[a.status] - order[b.status] || a.dueDate.localeCompare(b.dueDate) || a.key.localeCompare(b.key));
  const shown = items.slice(0, MAX_ITEMS);

  const pending = shown.filter((i) => i.status !== 'paid' && i.amountMinor !== null);
  return {
    asOf: now.toISOString(),
    from: today.toISOString(),
    to: horizon.toISOString(),
    items: shown,
    truncated: items.length > MAX_ITEMS,
    totals: {
      dueOutMinor: pending.filter((i) => i.direction === 'out').reduce((sum, i) => sum + i.amountMinor!, 0),
      dueInMinor: pending.filter((i) => i.direction === 'in').reduce((sum, i) => sum + i.amountMinor!, 0),
      overdueCount: shown.filter((i) => i.status === 'overdue').length,
      withoutAmountCount: shown.filter((i) => i.status !== 'paid' && i.amountMinor === null).length,
    },
  };
}

async function lookupNames(accountIds: Types.ObjectId[], payeeIds: Types.ObjectId[], personIds: Types.ObjectId[]) {
  const [accounts, payees, people] = await Promise.all([
    accountIds.length ? Account.find({ _id: { $in: accountIds } }).select('name').lean() : [],
    payeeIds.length ? Payee.find({ _id: { $in: payeeIds } }).select('name').lean() : [],
    personIds.length ? Person.find({ _id: { $in: personIds } }).select('name').lean() : [],
  ]);
  const toMap = (rows: Array<{ _id: Types.ObjectId; name: string }>) => new Map(rows.map((r) => [String(r._id), r.name]));
  return { account: toMap(accounts), payee: toMap(payees), person: toMap(people) };
}
