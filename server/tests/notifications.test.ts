import { beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';
import { checkBudgetAlerts } from '../src/modules/budgets/budget.service.js';
import { raiseRecurringNotifications } from '../src/modules/recurring/recurring.service.js';
import { raiseDueReminderNotifications, syncLoanReminders } from '../src/modules/reminders/reminder.service.js';

/**
 * Phase 1, finding P-1: the switches on Settings → Notifications must actually
 * decide what gets created (they were stored but never read).
 */

let user: TestUser;
let cash: string;
let expenseCategory: string;

const DAY = 24 * 60 * 60 * 1000;

function scopeOf(u: TestUser) {
  return {
    userId: Types.ObjectId.createFromHexString(u.userId),
    workspaceId: Types.ObjectId.createFromHexString(u.workspaceId),
    currency: 'INR',
    mode: 'personal' as const,
    role: 'owner' as const,
    hiddenAccountIds: [],
  };
}

async function notifications(u: TestUser): Promise<Array<{ type: string; title: string }>> {
  return (await as(u).get('/api/v1/notifications').expect(200)).body.data;
}

async function setPrefs(u: TestUser, prefs: Record<string, boolean>) {
  await as(u).patch('/api/v1/users/me/preferences').send({ notifications: prefs }).expect(200);
}

async function overspentBudget(u: TestUser) {
  await as(u)
    .post('/api/v1/budgets')
    .send({ name: 'Food', categoryId: expenseCategory, amountMinor: rupees(1_000), period: 'monthly' })
    .expect(201);
  await as(u)
    .post('/api/v1/transactions')
    .send({ type: 'expense', amountMinor: rupees(1_500), date: new Date().toISOString(), accountId: cash, categoryId: expenseCategory })
    .expect(201);
}

async function recurring(u: TestUser, body: Record<string, unknown>) {
  return (
    await as(u)
      .post('/api/v1/recurring')
      .send({ name: 'Rent', type: 'expense', amountMinor: rupees(12_000), accountId: cash, categoryId: expenseCategory, frequency: 'monthly', ...body })
      .expect(201)
  ).body.data;
}

beforeEach(async () => {
  user = await createTestUser();
  cash = (await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(50_000) }).expect(201)).body.data.id;
  expenseCategory = (await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id;
});

describe('budget alerts', () => {
  it('are raised while the switch is on', async () => {
    await overspentBudget(user);
    await checkBudgetAlerts(scopeOf(user));
    expect((await notifications(user)).map((n) => n.type)).toContain('budget_exceeded');
  });

  it('are not raised when "Budget alerts" is off', async () => {
    await setPrefs(user, { budgetAlerts: false });
    await overspentBudget(user);
    await checkBudgetAlerts(scopeOf(user));
    expect(await notifications(user)).toHaveLength(0);
  });

  it('are not raised when the in-app master switch is off', async () => {
    await setPrefs(user, { inApp: false });
    await overspentBudget(user);
    await checkBudgetAlerts(scopeOf(user));
    expect(await notifications(user)).toHaveLength(0);
  });
});

describe('loan reminders', () => {
  async function dueLoan() {
    const person = (await as(user).post('/api/v1/people').send({ name: 'Rahul' }).expect(201)).body.data.id;
    await as(user)
      .post(`/api/v1/people/${person}/lend`)
      .send({ amountMinor: rupees(2_000), accountId: cash, dueDate: new Date(Date.now() + DAY).toISOString() })
      .expect(201);
    await syncLoanReminders(scopeOf(user));
  }

  it('follow the "Money due" switch', async () => {
    await setPrefs(user, { moneyDue: false });
    await dueLoan();
    await raiseDueReminderNotifications(new Date());
    expect(await notifications(user)).toHaveLength(0);
  });

  it('are raised when "Money due" is on', async () => {
    await dueLoan();
    await raiseDueReminderNotifications(new Date());
    expect((await notifications(user)).map((n) => n.type)).toEqual(['money_due']);
  });
});

describe('recurring reminders', () => {
  it('announce an auto-posting item reminderDaysBefore days ahead, once', async () => {
    await recurring(user, { startDate: new Date(Date.now() + 2 * DAY).toISOString(), reminderDaysBefore: 3 });

    await raiseRecurringNotifications(new Date());
    await raiseRecurringNotifications(new Date());

    const list = await notifications(user);
    expect(list).toHaveLength(1);
    expect(list[0]!.type).toBe('recurring_upcoming');
    expect(list[0]!.title).toMatch(/^Rent posts in/);
  });

  it('stay quiet outside the lead time, and when the lead time is 0', async () => {
    await recurring(user, { startDate: new Date(Date.now() + 10 * DAY).toISOString(), reminderDaysBefore: 3 });
    await recurring(user, { name: 'Gym', startDate: new Date(Date.now() + DAY).toISOString(), reminderDaysBefore: 0 });
    await raiseRecurringNotifications(new Date());
    expect(await notifications(user)).toHaveLength(0);
  });

  it('ask the user to confirm a remind-only item once it is due', async () => {
    await recurring(user, { startDate: new Date(Date.now() - DAY).toISOString(), autoPost: false, reminderDaysBefore: 1 });
    await raiseRecurringNotifications(new Date());

    const list = await notifications(user);
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('Confirm: Rent');

    // Nothing was posted on the user's behalf.
    const transactions = await as(user).get('/api/v1/transactions?types=expense').expect(200);
    expect(transactions.body.data.total).toBe(0);
  });

  it('follow the "Recurring reminders" switch', async () => {
    await setPrefs(user, { recurringReminders: false });
    await recurring(user, { startDate: new Date(Date.now() - DAY).toISOString(), autoPost: false });
    await raiseRecurringNotifications(new Date());
    expect(await notifications(user)).toHaveLength(0);
  });

  it("never notify one user about another user's items", async () => {
    const other = await createTestUser();
    await recurring(user, { startDate: new Date(Date.now() - DAY).toISOString(), autoPost: false });
    await raiseRecurringNotifications(new Date());
    expect(await notifications(other)).toHaveLength(0);
    expect(await notifications(user)).toHaveLength(1);
  });
});
