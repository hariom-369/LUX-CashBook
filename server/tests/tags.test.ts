import { beforeEach, describe, expect, it } from 'vitest';
import { Transaction } from '../src/models/index.js';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Tag management (§Phase 2): list, rename, merge, delete and the tag report. Tags are labels —
 * none of this may change an amount or a balance — and it must respect private accounts.
 */

let user: TestUser;
let cash: string;
let expenseCat: string;

const spend = async (description: string, amount: number, tags: string[], accountId = cash) =>
  (
    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(amount), accountId, categoryId: expenseCat, date: new Date().toISOString(), description, tags })
      .expect(201)
  ).body.data.id as string;

beforeEach(async () => {
  user = await createTestUser();
  cash = (await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(100_000) }).expect(201)).body.data.id;
  expenseCat = (await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id;
});

const tagsOf = async (id: string) => (await as(user).get(`/api/v1/transactions/${id}`).expect(200)).body.data.tags as string[];

describe('listing tags', () => {
  it('counts transactions and totals expenses per tag, most used first', async () => {
    await spend('Lunch', 200, ['food', 'work']);
    await spend('Dinner', 300, ['food']);
    await spend('Taxi', 150, ['work']);
    const list = (await as(user).get('/api/v1/tags').expect(200)).body.data as Array<{ tag: string; transactionCount: number; expenseMinor: number }>;
    expect(list.map((t) => t.tag).sort()).toEqual(['food', 'work']);
    const food = list.find((t) => t.tag === 'food')!;
    expect(food.transactionCount).toBe(2);
    expect(food.expenseMinor).toBe(rupees(500));
  });

  it('ignores deleted transactions', async () => {
    const id = await spend('Oops', 10, ['oops']);
    await as(user).delete(`/api/v1/transactions/${id}`).expect(200);
    expect(((await as(user).get('/api/v1/tags').expect(200)).body.data as unknown[]).length).toBe(0);
  });
});

describe('renaming, merging and deleting', () => {
  it('renames a tag everywhere, without touching amounts or balances', async () => {
    const a = await spend('Lunch', 200, ['food', 'work']);
    const b = await spend('Dinner', 300, ['food']);
    const before = (await as(user).get(`/api/v1/accounts/${cash}`).expect(200)).body.data.balanceMinor;

    const res = await as(user).post('/api/v1/tags/rename').send({ from: 'Food', to: 'Meals' }).expect(200);
    expect(res.body.data.transactions).toBe(2);

    expect((await tagsOf(a)).sort()).toEqual(['meals', 'work']);
    expect(await tagsOf(b)).toEqual(['meals']);
    expect((await as(user).get(`/api/v1/accounts/${cash}`).expect(200)).body.data.balanceMinor).toBe(before);
    expect((await Transaction.findById(a))!.amountMinor).toBe(rupees(200));
  });

  it('bumps rev so an editor holding the old copy is told it changed', async () => {
    const id = await spend('Lunch', 200, ['food']);
    const rev = (await as(user).get(`/api/v1/transactions/${id}`).expect(200)).body.data.rev as number;
    await as(user).post('/api/v1/tags/rename').send({ from: 'food', to: 'meals' }).expect(200);
    const stale = await as(user).patch(`/api/v1/transactions/${id}`).send({ rev, description: 'Lunch!' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_REVISION');
  });

  it('merges several tags into one, de-duplicating a transaction that carried both', async () => {
    const a = await spend('A', 10, ['groceries', 'grocery']);
    const b = await spend('B', 10, ['grocery']);
    const c = await spend('C', 10, ['other']);
    await as(user).post('/api/v1/tags/merge').send({ sources: ['grocery', 'groceries'], target: 'food' }).expect(200);
    expect(await tagsOf(a)).toEqual(['food']);
    expect(await tagsOf(b)).toEqual(['food']);
    expect(await tagsOf(c)).toEqual(['other']);
  });

  it('refuses a no-op rename, a merge with nothing to merge, and an empty or oversized tag', async () => {
    await spend('A', 10, ['x']);
    await as(user).post('/api/v1/tags/rename').send({ from: 'x', to: 'X' }).expect(400);
    await as(user).post('/api/v1/tags/merge').send({ sources: ['x'], target: 'x' }).expect(400);
    await as(user).post('/api/v1/tags/rename').send({ from: 'x', to: '   ' }).expect(422);
    await as(user).post('/api/v1/tags/rename').send({ from: 'x', to: 'y'.repeat(41) }).expect(422);
  });

  it('removes a tag from every transaction', async () => {
    const a = await spend('A', 10, ['gone', 'keep']);
    await as(user).post('/api/v1/tags/delete').send({ tag: 'gone' }).expect(200);
    expect(await tagsOf(a)).toEqual(['keep']);
  });

  it('records each change in the audit trail', async () => {
    await spend('A', 10, ['x']);
    await as(user).post('/api/v1/tags/rename').send({ from: 'x', to: 'y' }).expect(200);
    const log = (await as(user).get('/api/v1/audit-log?limit=20').expect(200)).body.data.items as Array<{ summary: string }>;
    expect(log.some((e) => /Renamed tag "x" to "y"/.test(e.summary))).toBe(true);
  });

  it("does not touch another workspace's tags", async () => {
    const other = await createTestUser();
    const otherCash = (await as(other).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(1_000) }).expect(201)).body.data.id;
    const otherCat = (await as(other).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id;
    const theirs = (
      await as(other).post('/api/v1/transactions').send({ type: 'expense', amountMinor: 100, accountId: otherCash, categoryId: otherCat, date: new Date().toISOString(), tags: ['shared-name'] }).expect(201)
    ).body.data.id as string;
    await spend('Mine', 10, ['shared-name']);
    await as(user).post('/api/v1/tags/rename').send({ from: 'shared-name', to: 'renamed' }).expect(200);
    expect((await Transaction.findById(theirs))!.tags).toEqual(['shared-name']);
  });

});

describe('the tag report', () => {
  it('totals spend and income per tag in a period, counting a multi-tag transaction under each tag', async () => {
    await spend('Lunch', 200, ['food', 'work']);
    await spend('Taxi', 100, ['work']);
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const res = (await as(user).get(`/api/v1/tags/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).expect(200)).body.data;
    expect(res.overlapping).toBe(true);
    const work = res.rows.find((r: { tag: string }) => r.tag === 'work');
    expect(work.expenseMinor).toBe(rupees(300));
    expect(res.rows.find((r: { tag: string }) => r.tag === 'food').expenseMinor).toBe(rupees(200));
  });

  it('excludes transfers and anything outside the period', async () => {
    await spend('Old', 50, ['old']);
    const from = new Date(Date.now() + 86_400_000).toISOString();
    const to = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const res = (await as(user).get(`/api/v1/tags/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).expect(200)).body.data;
    expect(res.rows).toEqual([]);
  });
});
