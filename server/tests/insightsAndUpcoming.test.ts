import { beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { anon, as, createTestUser, rupees, type TestUser } from './helpers.js';
import { getMonthlyInsights } from '../src/modules/reports/monthlyInsights.service.js';
import { syncLoanReminders } from '../src/modules/reminders/reminder.service.js';
import { RecurringTransaction, Transaction } from '../src/models/index.js';

/**
 * Monthly insights (facts from recorded transactions only, estimates labelled) and the unified
 * upcoming-payments timeline (read-only, de-duplicated, honest about what's paid).
 */

let user: TestUser;
let bank: string;
let cash: string;
let categories: Array<{ id: string; name: string; kind: string }>;

const DAY = 24 * 60 * 60 * 1000;
const cat = (name: string) => categories.find((c) => c.name === name)!.id;

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

async function record(body: Record<string, unknown>) {
  return (await as(user).post('/api/v1/transactions').send({ accountId: bank, ...body }).expect(201)).body.data.id as string;
}

beforeEach(async () => {
  user = await createTestUser();
  bank = (await as(user).post('/api/v1/accounts').send({ name: 'Bank', type: 'bank', openingBalanceMinor: rupees(100_000) }).expect(201)).body.data.id;
  cash = (await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash' }).expect(201)).body.data.id;
  categories = [
    ...(await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data,
    ...(await as(user).get('/api/v1/categories?kind=income&flat=true').expect(200)).body.data,
  ];
});

describe('monthly insights', () => {
  async function augustAndSeptember() {
    const food = categories.find((c) => c.kind === 'expense')!.id;
    const other = categories.filter((c) => c.kind === 'expense')[1]!.id;
    const salary = categories.find((c) => c.kind === 'income' && c.name !== 'Refund')!.id;
    // August
    await record({ type: 'income', amountMinor: rupees(50_000), date: '2026-08-01T10:00:00', categoryId: salary });
    await record({ type: 'expense', amountMinor: rupees(10_000), date: '2026-08-12T10:00:00', categoryId: food });
    // September
    await record({ type: 'income', amountMinor: rupees(59_000), date: '2026-09-01T10:00:00', categoryId: salary });
    await record({ type: 'income', amountMinor: rupees(1_000), date: '2026-09-05T10:00:00', categoryId: cat('Refund'), description: 'Shoe return' });
    await record({ type: 'expense', amountMinor: rupees(20_000), date: '2026-09-10T10:00:00', categoryId: food });
    await record({ type: 'expense', amountMinor: rupees(15_000), date: '2026-09-03T10:00:00', categoryId: other });
    await record({ type: 'transfer', amountMinor: rupees(5_000), date: '2026-09-04T10:00:00', toAccountId: cash });
    const ravi = (await as(user).post('/api/v1/people').send({ name: 'Ravi' }).expect(201)).body.data.id;
    await as(user).post(`/api/v1/people/${ravi}/lend`).send({ amountMinor: rupees(3_000), accountId: bank, date: '2026-09-06T10:00:00' }).expect(201);
    await as(user).post(`/api/v1/people/${ravi}/repay`).send({ amountMinor: rupees(1_000), accountId: bank, date: '2026-09-20T10:00:00' }).expect(201);
    return { food, other };
  }

  it('reports a finished month from recorded transactions, leaving transfers and loans out', async () => {
    const { food, other } = await augustAndSeptember();
    const m = (await as(user).get('/api/v1/reports/monthly-insights?month=2026-09').expect(200)).body.data;

    expect(m).toMatchObject({
      month: '2026-09',
      isPartial: false,
      hasData: true,
      incomeMinor: rupees(60_000),
      refundsMinor: rupees(1_000),
      expenseMinor: rupees(35_000),
      netSavingsMinor: rupees(25_000),
      savingsRatePercent: 41.7,
      notCounted: { transfersMinor: rupees(5_000), loansAndRepaymentsMinor: rupees(4_000) },
      comparisonBasis: 'previous_month',
      comparison: { month: '2026-08', incomeMinor: rupees(50_000), expenseMinor: rupees(10_000), netSavingsMinor: rupees(40_000), hasData: true },
      projection: null,
      upcoming: null,
    });
    expect(m.categories.map((c: { categoryId: string; amountMinor: number; comparisonMinor: number; sharePercent: number }) => [c.categoryId, c.amountMinor, c.comparisonMinor, c.sharePercent])).toEqual([
      [food, rupees(20_000), rupees(10_000), 57.1],
      [other, rupees(15_000), 0, 42.9],
    ]);
    // Biggest moves first; a category with no spending last month has no percentage to invent.
    expect(m.significantChanges.map((c: { kind: string; changeMinor: number; changePercent: number | null }) => [c.kind, c.changeMinor, c.changePercent])).toEqual([
      ['expense', rupees(25_000), 250],
      ['category', rupees(15_000), null],
      ['income', rupees(10_000), 20],
      ['category', rupees(10_000), 100],
    ]);
  });

  it('counts a month in progress only up to today, compares it with the same days of last month, and labels the projection an estimate', async () => {
    const food = categories.find((c) => c.kind === 'expense')!.id;
    await record({ type: 'expense', amountMinor: rupees(1_000), date: '2026-09-05T10:00:00', categoryId: food });
    await record({ type: 'expense', amountMinor: rupees(9_999), date: '2026-09-20T10:00:00', categoryId: food }); // after "today"
    await record({ type: 'expense', amountMinor: rupees(2_000), date: '2026-08-03T10:00:00', categoryId: food });
    await record({ type: 'expense', amountMinor: rupees(50_000), date: '2026-08-25T10:00:00', categoryId: food }); // later in August

    const m = await getMonthlyInsights(scopeOf(user), '2026-09', new Date('2026-09-10T15:00:00'));
    expect(m).toMatchObject({ isPartial: true, daysElapsed: 10, daysInMonth: 30, expenseMinor: rupees(1_000), comparisonBasis: 'previous_month_to_date' });
    expect(m.comparison.expenseMinor).toBe(rupees(2_000));
    expect(m.projection).toEqual({ expenseMinor: rupees(3_000), isEstimate: true });
    expect(m.upcoming).toEqual({ count: 0, outMinor: 0, inMinor: 0, withoutAmountCount: 0 });
  });

  it('has nothing to say about an empty month, a deleted entry or another workspace', async () => {
    const empty = (await as(user).get('/api/v1/reports/monthly-insights?month=2026-05').expect(200)).body.data;
    expect(empty).toMatchObject({ hasData: false, incomeMinor: 0, expenseMinor: 0, savingsRatePercent: null, categories: [], significantChanges: [] });

    const id = await record({ type: 'expense', amountMinor: rupees(700), date: '2026-09-02T10:00:00', categoryId: categories[0]!.id });
    await as(user).delete(`/api/v1/transactions/${id}`).expect(200);
    expect((await as(user).get('/api/v1/reports/monthly-insights?month=2026-09').expect(200)).body.data.expenseMinor).toBe(0);

    await augustAndSeptember();
    const other = await createTestUser();
    expect((await as(other).get('/api/v1/reports/monthly-insights?month=2026-09').expect(200)).body.data.hasData).toBe(false);
    await anon().get('/api/v1/reports/monthly-insights').expect(401);
  });

  it('claims no changes when the month before has nothing recorded to compare with', async () => {
    const food = categories.find((c) => c.kind === 'expense')!.id;
    const salary = categories.find((c) => c.kind === 'income' && c.name !== 'Refund')!.id;
    await record({ type: 'income', amountMinor: rupees(51_000), date: '2026-09-01T10:00:00', categoryId: salary });
    await record({ type: 'expense', amountMinor: rupees(20_000), date: '2026-09-08T10:00:00', categoryId: food });

    const m = (await as(user).get('/api/v1/reports/monthly-insights?month=2026-09').expect(200)).body.data;
    expect(m.hasData).toBe(true);
    expect(m.comparison.hasData).toBe(false);
    expect(m.significantChanges).toEqual([]); // not "income rose by ₹51,000"
  });

  it('refuses a month that hasn\'t started and a malformed one', async () => {
    await as(user).get('/api/v1/reports/monthly-insights?month=2099-01').expect(400);
    await as(user).get('/api/v1/reports/monthly-insights?month=2026-13').expect(422);
  });
});

describe('upcoming payments', () => {
  const upcoming = async (query = '') => (await as(user).get(`/api/v1/upcoming${query}`).expect(200)).body.data;
  const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

  async function recurring(body: Record<string, unknown> = {}) {
    return (
      await as(user)
        .post('/api/v1/recurring')
        .send({ name: 'Rent', type: 'expense', amountMinor: rupees(12_000), accountId: bank, frequency: 'monthly', startDate: inDays(5), ...body })
        .expect(201)
    ).body.data;
  }

  it('projects recurring payments from their schedule without creating any transaction', async () => {
    const rent = await recurring();
    const before = await Transaction.countDocuments({ workspaceId: user.workspaceId });

    const thirty = await upcoming('?days=30');
    const rentItems = thirty.items.filter((i: { sourceId: string }) => i.sourceId === rent.id);
    expect(rentItems).toHaveLength(1);
    expect(rentItems[0]).toMatchObject({ source: 'recurring', title: 'Rent', amountMinor: rupees(12_000), direction: 'out', status: 'upcoming', autoPost: true, accountName: 'Bank' });

    const sixty = await upcoming('?days=60');
    const keys = sixty.items.filter((i: { sourceId: string }) => i.sourceId === rent.id).map((i: { key: string }) => i.key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    expect((await upcoming('?days=60')).items.map((i: { key: string }) => i.key)).toEqual(sixty.items.map((i: { key: string }) => i.key)); // stable
    expect(await Transaction.countDocuments({ workspaceId: user.workspaceId })).toBe(before);
    expect(thirty.totals.dueOutMinor).toBe(rupees(12_000));
  });

  it('follows edits, pauses and deletions straight away', async () => {
    const rent = await recurring();
    await as(user).patch(`/api/v1/recurring/${rent.id}`).send({ amountMinor: rupees(13_000) }).expect(200);
    expect((await upcoming()).items.find((i: { sourceId: string }) => i.sourceId === rent.id).amountMinor).toBe(rupees(13_000));

    await RecurringTransaction.updateOne({ _id: rent.id }, { $set: { isPaused: true } });
    expect((await upcoming()).items.some((i: { sourceId: string }) => i.sourceId === rent.id)).toBe(false);

    await RecurringTransaction.updateOne({ _id: rent.id }, { $set: { isPaused: false } });
    await as(user).delete(`/api/v1/recurring/${rent.id}`).expect(200);
    expect((await upcoming()).items.some((i: { sourceId: string }) => i.sourceId === rent.id)).toBe(false);
  });

  it('shows an unconfirmed recurring payment from before today as overdue', async () => {
    const bill = await recurring({ name: 'Internet', autoPost: false });
    await RecurringTransaction.updateOne({ _id: bill.id }, { $set: { nextRunDate: new Date(Date.now() - 3 * DAY) } });
    const data = await upcoming();
    expect(data.items[0]).toMatchObject({ sourceId: bill.id, status: 'overdue', autoPost: false });
    expect(data.totals.overdueCount).toBe(1);
  });

  it('lists a loan due date once, with what is still outstanding, and marks it paid when settled', async () => {
    const ravi = (await as(user).post('/api/v1/people').send({ name: 'Ravi' }).expect(201)).body.data.id;
    await as(user).post(`/api/v1/people/${ravi}/borrow`).send({ amountMinor: rupees(4_000), accountId: bank, dueDate: inDays(10) }).expect(201);
    await syncLoanReminders(scopeOf(user)); // the generated reminder must not appear as a second item

    let items = (await upcoming()).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: 'loan', direction: 'out', amountMinor: rupees(4_000), counterparty: 'Ravi', status: 'upcoming' });

    await as(user).post(`/api/v1/people/${ravi}/repay`).send({ amountMinor: rupees(1_500), accountId: bank }).expect(201);
    items = (await upcoming()).items;
    expect(items[0].amountMinor).toBe(rupees(2_500));

    await as(user).post(`/api/v1/people/${ravi}/repay`).send({ amountMinor: rupees(2_500), accountId: bank }).expect(201);
    items = (await upcoming()).items.filter((i: { source: string }) => i.source === 'loan');
    expect(items).toEqual([expect.objectContaining({ status: 'paid', amountMinor: rupees(4_000) })]);
  });

  it('shows a loan with an installment plan as its installments, each paid off in order', async () => {
    const ravi = (await as(user).post('/api/v1/people').send({ name: 'Ravi' }).expect(201)).body.data.id;
    const loan = (await as(user).post(`/api/v1/people/${ravi}/borrow`).send({ amountMinor: rupees(3_000), accountId: bank, dueDate: inDays(25) }).expect(201)).body.data.id;
    await as(user)
      .put(`/api/v1/loans/${loan}/installments`)
      .send({ installments: [5, 15, 25].map((d) => ({ dueDate: inDays(d), amountMinor: rupees(1_000) })) })
      .expect(200);
    await syncLoanReminders(scopeOf(user));
    await as(user).post(`/api/v1/people/${ravi}/repay`).send({ amountMinor: rupees(1_500), accountId: bank }).expect(201);

    const items = (await upcoming()).items;
    expect(items.every((i: { source: string }) => i.source === 'installment')).toBe(true);
    expect(items.map((i: { status: string; amountMinor: number }) => [i.status, i.amountMinor])).toEqual([
      ['upcoming', rupees(500)], // half of the second is paid
      ['upcoming', rupees(1_000)],
      ['paid', rupees(1_000)],
    ]);
  });

  it('includes your own reminders, but not document expiries, and shows done ones as paid', async () => {
    await as(user).post('/api/v1/reminders').send({ title: 'School fees', type: 'custom', dueDate: inDays(3), amountMinor: rupees(8_000) }).expect(201);
    const done = (await as(user).post('/api/v1/reminders').send({ title: 'Gas', type: 'bill', dueDate: inDays(-1) }).expect(201)).body.data.id;
    await as(user).post(`/api/v1/reminders/${done}/complete`).expect(200);
    await as(user).post('/api/v1/reminders').send({ title: 'Passport', type: 'document_expiry', dueDate: inDays(4) }).expect(201);

    const data = await upcoming();
    expect(data.items.map((i: { title: string; status: string }) => [i.title, i.status])).toEqual([
      ['School fees', 'upcoming'],
      ['Gas', 'paid'],
    ]);
    expect(data.totals).toMatchObject({ dueOutMinor: rupees(8_000), withoutAmountCount: 0 });
  });

  it('lists a recurring payment made recently as paid, linked to its transaction', async () => {
    const rent = await recurring({ startDate: new Date().toISOString() });
    await as(user).post(`/api/v1/recurring/${rent.id}/run`).expect(201);
    const paid = (await upcoming()).items.filter((i: { status: string }) => i.status === 'paid');
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ title: 'Rent', amountMinor: rupees(12_000) });
    expect(await Transaction.exists({ _id: paid[0].transactionId })).not.toBeNull();
  });

  it('is private to the workspace and validates its window', async () => {
    await recurring();
    const other = await createTestUser();
    expect((await as(other).get('/api/v1/upcoming').expect(200)).body.data.items).toEqual([]);
    await anon().get('/api/v1/upcoming').expect(401);
    await as(user).get('/api/v1/upcoming?days=0').expect(422);
    await as(user).get('/api/v1/upcoming?days=91').expect(422);
  });
});
