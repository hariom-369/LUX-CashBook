import { beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';
import { checkBudgetAlerts } from '../src/modules/budgets/budget.service.js';
import { Notification } from '../src/models/index.js';

/**
 * Smart budget alerts: each budget warns at its own thresholds (75 / 90 / 100% by default),
 * at most once per threshold per budget period, from spend computed off live transactions.
 */

let user: TestUser;
let cash: string;
let food: string;

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

const alerts = async (u = user) =>
  (await Notification.find({ userId: Types.ObjectId.createFromHexString(u.userId), type: { $in: ['budget_warning', 'budget_exceeded'] } }).sort({ createdAt: 1 }).lean()).map(
    (n) => n.title,
  );

async function budget(body: Record<string, unknown> = {}) {
  return (
    await as(user)
      .post('/api/v1/budgets')
      .send({ name: 'Food', categoryId: food, amountMinor: rupees(1_000), period: 'monthly', startDate: '2026-01-01T00:00:00.000Z', ...body })
      .expect(201)
  ).body.data;
}

async function spend(amount: number, date = new Date()) {
  await as(user)
    .post('/api/v1/transactions')
    .send({ type: 'expense', amountMinor: rupees(amount), date: date.toISOString(), accountId: cash, categoryId: food })
    .expect(201);
}

beforeEach(async () => {
  user = await createTestUser();
  cash = (await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(50_000) }).expect(201)).body.data.id;
  food = (await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id;
});

describe('budget thresholds', () => {
  it('defaults new budgets to 75%, 90% and 100%', async () => {
    expect((await budget()).alertThresholds).toEqual([75, 90, 100]);
  });

  it('alerts once per threshold as spending climbs, never repeating one', async () => {
    await budget();
    await spend(760); // 76%
    await checkBudgetAlerts(scopeOf(user));
    await checkBudgetAlerts(scopeOf(user)); // the scheduler runs every few minutes
    expect(await alerts()).toEqual(['Food budget at 75%']);

    await spend(150); // 91%
    await checkBudgetAlerts(scopeOf(user));
    await spend(100); // 101%
    await checkBudgetAlerts(scopeOf(user));
    await checkBudgetAlerts(scopeOf(user));
    expect(await alerts()).toEqual(['Food budget at 75%', 'Food budget at 90%', 'Food budget exceeded']);
  });

  it('sends only the highest threshold crossed in one jump, not a burst of every lower one', async () => {
    await budget();
    await spend(1_200);
    await checkBudgetAlerts(scopeOf(user));
    expect(await alerts()).toEqual(['Food budget exceeded']);
  });

  it('honours a budget\'s own thresholds, and none at all', async () => {
    await budget({ name: 'Fuel', alertThresholds: [50] });
    await spend(550);
    await checkBudgetAlerts(scopeOf(user));
    expect(await alerts()).toEqual(['Fuel budget at 50%']);

    const other = (await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[1].id;
    const quiet = await budget({ name: 'Snacks', categoryId: other, alertThresholds: [] });
    expect(quiet.alertThresholds).toEqual([]);
    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(2_000), date: new Date().toISOString(), accountId: cash, categoryId: other })
      .expect(201);
    await checkBudgetAlerts(scopeOf(user));
    expect(await alerts()).toEqual(['Fuel budget at 50%']); // Snacks is at 200% but asked for silence
  });

  it('lets thresholds be changed on an existing budget', async () => {
    const b = await budget();
    const updated = await as(user).patch(`/api/v1/budgets/${b.id}`).send({ alertThresholds: [60, 100], rev: b.rev }).expect(200);
    expect(updated.body.data.alertThresholds).toEqual([60, 100]);
  });

  it('alerts again in a new period of a weekly budget — and only then', async () => {
    await budget({ period: 'weekly' });
    const week1 = new Date('2026-09-09T12:00:00');
    const week2 = new Date('2026-09-16T12:00:00');
    await spend(800, new Date('2026-09-08T12:00:00'));
    await checkBudgetAlerts(scopeOf(user), week1);
    await checkBudgetAlerts(scopeOf(user), week1);
    expect(await alerts()).toHaveLength(1);

    await spend(800, new Date('2026-09-15T12:00:00'));
    await checkBudgetAlerts(scopeOf(user), week2);
    expect(await alerts()).toEqual(['Food budget at 75%', 'Food budget at 75%']);
  });

  it('keeps the monthly duplicate key it always used, so this month\'s alerts are not resent after upgrading', async () => {
    const b = await budget();
    await spend(800);
    await checkBudgetAlerts(scopeOf(user));
    const now = new Date();
    const [n] = await Notification.find({ type: 'budget_warning', userId: Types.ObjectId.createFromHexString(user.userId) }).lean();
    expect(n!.dedupeKey).toBe(`budget:${b.id}:${now.getFullYear()}-${now.getMonth() + 1}:75`);
  });

  it('says nothing about a budget in Trash, or to anyone else', async () => {
    const b = await budget();
    await spend(1_500);
    await as(user).delete(`/api/v1/budgets/${b.id}`).expect(200);
    await checkBudgetAlerts(scopeOf(user));
    expect(await alerts()).toEqual([]);

    const other = await createTestUser();
    await checkBudgetAlerts(scopeOf(other));
    expect(await alerts(other)).toEqual([]);
  });
});
