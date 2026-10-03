import { beforeEach, describe, expect, it } from 'vitest';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Phase 7 (docs/ROADMAP_PHASE7_NOTES.md): credit card centre, account-scoped
 * budgets with a linear spend projection, goal status + real transfer
 * contributions, and the cash-flow forecast.
 */

let user: TestUser;
let cash: string;
let expenseCategory: string;

beforeEach(async () => {
  user = await createTestUser();
  cash = (await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(10_000) }).expect(201)).body.data.id;
  expenseCategory = (await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id;
});

describe('credit card centre', () => {
  it('computes utilisation and the next due date from the account\'s own balance and limit', async () => {
    const card = (await as(user)
      .post('/api/v1/accounts')
      .send({ name: 'HDFC Card', type: 'credit_card', creditLimitMinor: rupees(50_000), dueDay: 15, statementDay: 1 })
      .expect(201)).body.data.id;

    // Spend ₹20,000 on the card — its balance goes to -20,000.
    await as(user).post('/api/v1/transactions').send({
      type: 'expense', amountMinor: rupees(20_000), accountId: card, categoryId: expenseCategory, date: new Date().toISOString(),
    }).expect(201);

    const summary = await as(user).get(`/api/v1/accounts/${card}/card-summary`).expect(200);
    expect(summary.body.data.outstandingMinor).toBe(rupees(20_000));
    expect(summary.body.data.utilizationPercent).toBe(40);
    expect(summary.body.data.dueDay).toBe(15);
    expect(summary.body.data.nextDueDate).toBeTruthy();
  });

  it('raises a payment-due reminder only while the card carries a balance', async () => {
    const { syncCardDueReminders } = await import('../src/modules/reminders/reminder.service.js');
    const { Types } = await import('mongoose');
    const scope = {
      userId: Types.ObjectId.createFromHexString(user.userId),
      workspaceId: Types.ObjectId.createFromHexString(user.workspaceId),
      currency: 'INR',
      mode: 'personal' as const,
      role: 'owner' as const,
      hiddenAccountIds: [],
    };

    const card = (await as(user).post('/api/v1/accounts').send({ name: 'Card', type: 'credit_card', dueDay: 10 }).expect(201)).body.data.id;
    await syncCardDueReminders(scope);
    expect((await as(user).get('/api/v1/reminders').expect(200)).body.data).toEqual([]);

    await as(user).post('/api/v1/transactions').send({
      type: 'expense', amountMinor: rupees(5_000), accountId: card, categoryId: expenseCategory, date: new Date().toISOString(),
    }).expect(201);
    await syncCardDueReminders(scope);
    expect((await as(user).get('/api/v1/reminders').expect(200)).body.data).toHaveLength(1);
  });
});

describe('budgets 2.0', () => {
  it('scopes spend to one account when accountId is set, leaving other accounts out', async () => {
    const otherCash = (await as(user).post('/api/v1/accounts').send({ name: 'Other Wallet', type: 'cash', openingBalanceMinor: rupees(10_000) }).expect(201)).body.data.id;

    await as(user).post('/api/v1/budgets').send({ name: 'Wallet groceries', categoryId: expenseCategory, accountId: cash, amountMinor: rupees(5_000) }).expect(201);

    await as(user).post('/api/v1/transactions').send({ type: 'expense', amountMinor: rupees(1_000), accountId: cash, categoryId: expenseCategory, date: new Date().toISOString() }).expect(201);
    await as(user).post('/api/v1/transactions').send({ type: 'expense', amountMinor: rupees(2_000), accountId: otherCash, categoryId: expenseCategory, date: new Date().toISOString() }).expect(201);

    const budgets = await as(user).get('/api/v1/budgets').expect(200);
    expect(budgets.body.data[0].spentMinor).toBe(rupees(1_000));
    expect(typeof budgets.body.data[0].projectedSpendMinor).toBe('number');
  });

  it('suggests last month\'s spend for a category with no active budget, and excludes already-budgeted ones', async () => {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1, 15);

    await as(user).post('/api/v1/transactions').send({ type: 'expense', amountMinor: rupees(3_000), accountId: cash, categoryId: expenseCategory, date: lastMonth.toISOString() }).expect(201);

    const suggestions = await as(user).get('/api/v1/budgets/suggestions').expect(200);
    expect(suggestions.body.data.find((s: { categoryId: string }) => s.categoryId === expenseCategory)?.lastMonthSpentMinor).toBe(rupees(3_000));

    await as(user).post('/api/v1/budgets').send({ name: 'Covered now', categoryId: expenseCategory, amountMinor: rupees(5_000) }).expect(201);
    const after = await as(user).get('/api/v1/budgets/suggestions').expect(200);
    expect(after.body.data.find((s: { categoryId: string }) => s.categoryId === expenseCategory)).toBeUndefined();
  });
});

describe('goals 2.0', () => {
  it('reports achieved/no_deadline status, and contributes to a linked goal via a real transfer', async () => {
    const vault = (await as(user).post('/api/v1/accounts').send({ name: 'Vault', type: 'savings', openingBalanceMinor: 0 }).expect(201)).body.data.id;
    const goal = (await as(user).post('/api/v1/goals').send({ name: 'Emergency fund', targetMinor: rupees(5_000), linkedAccountId: vault }).expect(201)).body.data.id;

    let progress = await as(user).get('/api/v1/goals').expect(200);
    expect(progress.body.data[0].status).toBe('no_deadline');

    await as(user)
      .post(`/api/v1/goals/${goal}/transfer-contribution`)
      .send({ fromAccountId: cash, amountMinor: rupees(5_000) })
      .expect(201);

    progress = await as(user).get('/api/v1/goals').expect(200);
    expect(progress.body.data[0].currentMinor).toBe(rupees(5_000));
    expect(progress.body.data[0].status).toBe('achieved');

    const walletAfter = await as(user).get(`/api/v1/accounts/${cash}`).expect(200);
    expect(walletAfter.body.data.balanceMinor).toBe(rupees(5_000)); // 10,000 - 5,000 transferred out
  });

  it('refuses a manual contribution on a linked goal, and a transfer-contribution on an unlinked one', async () => {
    const linked = (await as(user).post('/api/v1/accounts').send({ name: 'Vault', type: 'savings' }).expect(201)).body.data.id;
    const linkedGoal = (await as(user).post('/api/v1/goals').send({ name: 'Linked', targetMinor: rupees(1_000), linkedAccountId: linked }).expect(201)).body.data.id;
    const manualGoal = (await as(user).post('/api/v1/goals').send({ name: 'Manual', targetMinor: rupees(1_000) }).expect(201)).body.data.id;

    await as(user).post(`/api/v1/goals/${linkedGoal}/contributions`).send({ amountMinor: rupees(100) }).expect(400);
    await as(user).post(`/api/v1/goals/${manualGoal}/transfer-contribution`).send({ fromAccountId: cash, amountMinor: rupees(100) }).expect(400);
  });
});

describe('cash-flow forecast', () => {
  it('is labelled as an estimate and projects recurring income/expense forward from the current total', async () => {
    await as(user)
      .post('/api/v1/recurring')
      .send({
        name: 'Salary', type: 'income', amountMinor: rupees(50_000), accountId: cash,
        frequency: 'monthly', startDate: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      })
      .expect(201);

    const forecast = await as(user).get('/api/v1/forecast?days=30').expect(200);
    expect(forecast.body.data.isEstimate).toBe(true);
    expect(forecast.body.data.startingBalanceMinor).toBe(rupees(10_000));
    expect(forecast.body.data.points).toHaveLength(31);
    const last = forecast.body.data.points[forecast.body.data.points.length - 1];
    expect(last.projectedBalanceMinor).toBe(rupees(60_000));
  });
});
