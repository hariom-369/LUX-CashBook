import { beforeEach, describe, expect, it } from 'vitest';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';
import { processDueRecurring, computeNextRun } from '../src/modules/recurring/recurring.service.js';
import { syncLoanReminders } from '../src/modules/reminders/reminder.service.js';

let user: TestUser;
let cash: string;
let expenseCategory: string;
let incomeCategory: string;

beforeEach(async () => {
  user = await createTestUser();

  const accountResponse = await as(user)
    .post('/api/v1/accounts')
    .send({ name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(20_000) })
    .expect(201);
  cash = accountResponse.body.data.id;

  const expenseCategories = await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200);
  expenseCategory = expenseCategories.body.data[0].id;
  const incomeCategories = await as(user).get('/api/v1/categories?kind=income&flat=true').expect(200);
  incomeCategory = incomeCategories.body.data[0].id;
});

describe('budgets', () => {
  it('computes live spend from transactions rather than a stored figure', async () => {
    const created = await as(user)
      .post('/api/v1/budgets')
      .send({ name: 'Food', categoryId: expenseCategory, amountMinor: rupees(8_000), period: 'monthly' })
      .expect(201);

    let list = await as(user).get('/api/v1/budgets').expect(200);
    expect(list.body.data[0].spentMinor).toBe(0);
    expect(list.body.data[0].status).toBe('safe');

    await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'expense',
        amountMinor: rupees(6_000),
        date: new Date().toISOString(),
        accountId: cash,
        categoryId: expenseCategory,
      })
      .expect(201);

    list = await as(user).get('/api/v1/budgets').expect(200);
    const budget = list.body.data.find((b: { id: string }) => b.id === created.body.data.id);
    expect(budget.spentMinor).toBe(rupees(6_000));
    expect(budget.remainingMinor).toBe(rupees(2_000));
    expect(budget.percentUsed).toBeCloseTo(75, 1);
    expect(budget.status).toBe('warning');
  });

  it('reflects a deleted transaction immediately', async () => {
    await as(user)
      .post('/api/v1/budgets')
      .send({ name: 'Food', categoryId: expenseCategory, amountMinor: rupees(8_000) })
      .expect(201);

    const txn = await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(6_000), date: new Date().toISOString(), accountId: cash, categoryId: expenseCategory })
      .expect(201);

    await as(user).delete(`/api/v1/transactions/${txn.body.data.id}`).expect(200);

    const list = await as(user).get('/api/v1/budgets').expect(200);
    expect(list.body.data[0].spentMinor).toBe(0);
  });

  it('refuses a second active budget for the same category and period', async () => {
    await as(user)
      .post('/api/v1/budgets')
      .send({ name: 'Food', categoryId: expenseCategory, amountMinor: rupees(8_000) })
      .expect(201);

    const response = await as(user)
      .post('/api/v1/budgets')
      .send({ name: 'Food Again', categoryId: expenseCategory, amountMinor: rupees(5_000) })
      .expect(409);

    expect(response.body.error.code).toBe('BUDGET_EXISTS');
  });

  it('marks a budget exceeded once spend passes the limit', async () => {
    await as(user)
      .post('/api/v1/budgets')
      .send({ name: 'Food', categoryId: expenseCategory, amountMinor: rupees(1_000) })
      .expect(201);

    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(1_500), date: new Date().toISOString(), accountId: cash, categoryId: expenseCategory })
      .expect(201);

    const list = await as(user).get('/api/v1/budgets').expect(200);
    expect(list.body.data[0].status).toBe('exceeded');
    expect(list.body.data[0].remainingMinor).toBe(-rupees(500));
  });
});

describe('savings goals', () => {
  it('tracks manual contributions and marks the goal achieved', async () => {
    const goal = await as(user)
      .post('/api/v1/goals')
      .send({ name: 'New Laptop', targetMinor: rupees(80_000) })
      .expect(201);

    let list = await as(user).get('/api/v1/goals').expect(200);
    expect(list.body.data[0].currentMinor).toBe(0);
    expect(list.body.data[0].percentComplete).toBe(0);

    await as(user)
      .post(`/api/v1/goals/${goal.body.data.id}/contributions`)
      .send({ amountMinor: rupees(35_000) })
      .expect(201);

    list = await as(user).get('/api/v1/goals').expect(200);
    expect(list.body.data[0].currentMinor).toBe(rupees(35_000));
    expect(list.body.data[0].percentComplete).toBeCloseTo(43.75, 1);
    expect(list.body.data[0].isAchieved).toBe(false);

    await as(user)
      .post(`/api/v1/goals/${goal.body.data.id}/contributions`)
      .send({ amountMinor: rupees(45_000) })
      .expect(201);

    list = await as(user).get('/api/v1/goals').expect(200);
    expect(list.body.data[0].currentMinor).toBe(rupees(80_000));
    expect(list.body.data[0].isAchieved).toBe(true);
  });

  it('tracks progress from a linked account balance instead of contributions', async () => {
    const savings = await as(user)
      .post('/api/v1/accounts')
      .send({ name: 'Emergency Fund', type: 'savings', openingBalanceMinor: rupees(10_000) })
      .expect(201);

    const goal = await as(user)
      .post('/api/v1/goals')
      .send({ name: 'Emergency Fund', targetMinor: rupees(50_000), linkedAccountId: savings.body.data.id })
      .expect(201);

    let list = await as(user).get('/api/v1/goals').expect(200);
    expect(list.body.data.find((g: { id: string }) => g.id === goal.body.data.id).currentMinor).toBe(rupees(10_000));

    // Money moving into the linked account moves the goal automatically.
    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'income', amountMinor: rupees(5_000), date: new Date().toISOString(), accountId: savings.body.data.id, categoryId: incomeCategory })
      .expect(201);

    list = await as(user).get('/api/v1/goals').expect(200);
    expect(list.body.data.find((g: { id: string }) => g.id === goal.body.data.id).currentMinor).toBe(rupees(15_000));
  });

  it('refuses a manual contribution on an account-linked goal', async () => {
    const savings = await as(user)
      .post('/api/v1/accounts')
      .send({ name: 'Vacation Fund', type: 'savings', openingBalanceMinor: 0 })
      .expect(201);

    const goal = await as(user)
      .post('/api/v1/goals')
      .send({ name: 'Vacation', targetMinor: rupees(50_000), linkedAccountId: savings.body.data.id })
      .expect(201);

    await as(user)
      .post(`/api/v1/goals/${goal.body.data.id}/contributions`)
      .send({ amountMinor: rupees(1_000) })
      .expect(400);
  });
});

describe('recurring transactions', () => {
  it('computes the next monthly run date, clamped to a valid day', () => {
    const next = computeNextRun(
      { frequency: 'monthly', dayOfMonth: 31, intervalDays: undefined, dayOfWeek: undefined, monthOfYear: undefined },
      new Date('2026-01-31T12:00:00.000Z'),
    );
    // February has no 31st — clamp to the 28th (2026 is not a leap year).
    expect(next.getUTCMonth()).toBe(1);
    expect(next.getUTCDate()).toBe(28);
  });

  it('posts a due occurrence exactly once even if the sweep runs twice concurrently', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recurring = await as(user)
      .post('/api/v1/recurring')
      .send({
        name: 'Rent',
        type: 'expense',
        amountMinor: rupees(12_000),
        accountId: cash,
        categoryId: expenseCategory,
        frequency: 'monthly',
        startDate: past.toISOString(),
      })
      .expect(201);

    expect(recurring.body.data.occurrencesCreated).toBe(0);

    // Run two sweeps "concurrently" — the atomic claim on nextRunDate must let
    // only one of them win.
    const [a, b] = await Promise.all([processDueRecurring(new Date()), processDueRecurring(new Date())]);
    expect(a.posted + b.posted).toBe(1);

    const list = await as(user).get('/api/v1/transactions?types=expense').expect(200);
    expect(list.body.data.total).toBe(1);

    const after = await as(user).get('/api/v1/recurring').expect(200);
    expect(after.body.data[0].occurrencesCreated).toBe(1);
  });

  it('lets the user run an occurrence immediately', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const recurring = await as(user)
      .post('/api/v1/recurring')
      .send({
        name: 'Salary',
        type: 'income',
        amountMinor: rupees(50_000),
        accountId: cash,
        categoryId: incomeCategory,
        frequency: 'monthly',
        startDate: future.toISOString(),
      })
      .expect(201);

    await as(user).post(`/api/v1/recurring/${recurring.body.data.id}/run`).expect(201);

    const account = await as(user).get(`/api/v1/accounts/${cash}`).expect(200);
    expect(account.body.data.balanceMinor).toBe(rupees(70_000));
  });

  it('stops posting once maxOccurrences is reached', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recurring = await as(user)
      .post('/api/v1/recurring')
      .send({
        name: 'Short subscription',
        type: 'expense',
        amountMinor: rupees(500),
        accountId: cash,
        categoryId: expenseCategory,
        frequency: 'daily',
        startDate: past.toISOString(),
        maxOccurrences: 1,
      })
      .expect(201);

    await as(user).post(`/api/v1/recurring/${recurring.body.data.id}/run`).expect(201);

    const list = await as(user).get('/api/v1/recurring').expect(200);
    // isActive turns false once the cap is hit, so it drops out of the active list.
    expect(list.body.data.find((r: { id: string }) => r.id === recurring.body.data.id)).toBeUndefined();
  });
});

describe('loan reminders', () => {
  it('generates a reminder for an outstanding loan with a due date and retires it once settled', async () => {
    const person = await as(user).post('/api/v1/people').send({ name: 'Rahul' }).expect(201);
    const dueDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

    await as(user)
      .post(`/api/v1/people/${person.body.data.id}/lend`)
      .send({ amountMinor: rupees(5_000), accountId: cash, dueDate: dueDate.toISOString() })
      .expect(201);

    const scope = {
      userId: (await import('mongoose')).Types.ObjectId.createFromHexString(user.userId),
      workspaceId: (await import('mongoose')).Types.ObjectId.createFromHexString(user.workspaceId),
      currency: 'INR',
      mode: 'personal' as const,
    };
    await syncLoanReminders(scope);

    let reminders = await as(user).get('/api/v1/reminders').expect(200);
    expect(reminders.body.data).toHaveLength(1);
    expect(reminders.body.data[0].type).toBe('loan_due');
    expect(reminders.body.data[0].amountMinor).toBe(rupees(5_000));

    // Settle it — the reminder must disappear on the next sync.
    await as(user).post(`/api/v1/people/${person.body.data.id}/settle`).send({ accountId: cash }).expect(200);
    await syncLoanReminders(scope);

    reminders = await as(user).get('/api/v1/reminders').expect(200);
    expect(reminders.body.data).toHaveLength(0);
  });
});

describe('reports', () => {
  it('computes net worth as assets minus liabilities plus receivables minus payables', async () => {
    const card = await as(user)
      .post('/api/v1/accounts')
      .send({ name: 'Credit Card', type: 'credit_card', openingBalanceMinor: 0 })
      .expect(201);

    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(3_000), date: new Date().toISOString(), accountId: card.body.data.id, categoryId: expenseCategory })
      .expect(201);

    const person = await as(user).post('/api/v1/people').send({ name: 'Amit' }).expect(201);
    await as(user)
      .post(`/api/v1/people/${person.body.data.id}/lend`)
      .send({ amountMinor: rupees(2_000), accountId: cash })
      .expect(201);

    const netWorth = await as(user).get('/api/v1/reports/net-worth').expect(200);
    // cash 20,000 - 2,000 lent = 18,000 in the account, + 2,000 receivable = 20,000 assets
    // liabilities: 3,000 owed on the card
    expect(netWorth.body.data.assetsMinor).toBe(rupees(20_000));
    expect(netWorth.body.data.liabilitiesMinor).toBe(rupees(3_000));
    expect(netWorth.body.data.netWorthMinor).toBe(rupees(17_000));
  });

  it('never counts a transfer or a loan in the category report', async () => {
    const bank = await as(user).post('/api/v1/accounts').send({ name: 'Bank', type: 'bank', openingBalanceMinor: 0 }).expect(201);
    const person = await as(user).post('/api/v1/people').send({ name: 'Vikas' }).expect(201);

    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(1_000), date: new Date().toISOString(), accountId: cash, categoryId: expenseCategory })
      .expect(201);
    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'transfer', amountMinor: rupees(5_000), date: new Date().toISOString(), accountId: cash, toAccountId: bank.body.data.id })
      .expect(201);
    await as(user)
      .post(`/api/v1/people/${person.body.data.id}/lend`)
      .send({ amountMinor: rupees(2_000), accountId: cash })
      .expect(201);

    const report = await as(user).get('/api/v1/reports/category?kind=expense').expect(200);
    const total = report.body.data.reduce((sum: number, row: { amountMinor: number }) => sum + row.amountMinor, 0);
    expect(total).toBe(rupees(1_000));
  });
});
