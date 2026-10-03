import { beforeEach, describe, expect, it } from 'vitest';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Phase 8 (docs/ROADMAP_PHASE8_NOTES.md): split payments across categories,
 * and expense groups — decision 1's "build it around the engine" design,
 * where a group expense you paid is always one ordinary `expense` (your
 * share) plus one `lend` per member, created atomically.
 */

let user: TestUser;
let bank: string;
let expenseCategory: string;

beforeEach(async () => {
  user = await createTestUser();
  bank = (await as(user).post('/api/v1/accounts').send({ name: 'Bank', type: 'bank', openingBalanceMinor: rupees(50_000) }).expect(201)).body.data.id;
  expenseCategory = (await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id;
});

describe('split transactions', () => {
  it('posts every part sharing one splitGroupId, summing exactly to the total debited from the account', async () => {
    const categories = await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200);
    const grocery = categories.body.data[0].id;
    const household = categories.body.data[1].id;

    const res = await as(user)
      .post('/api/v1/transactions/split')
      .send({
        type: 'expense',
        accountId: bank,
        date: new Date().toISOString(),
        description: 'Supermarket run',
        parts: [
          { categoryId: grocery, amountMinor: rupees(1_500) },
          { categoryId: household, amountMinor: rupees(900) },
        ],
      })
      .expect(201);

    expect(res.body.data).toHaveLength(2);
    const [first, second] = res.body.data;
    expect(first.splitGroupId).toBe(second.splitGroupId);
    expect(first.splitGroupId).toBeTruthy();

    const account = await as(user).get(`/api/v1/accounts/${bank}`).expect(200);
    expect(account.body.data.balanceMinor).toBe(rupees(50_000) - rupees(2_400));
  });

  it('refuses a split with fewer than two parts', async () => {
    await as(user)
      .post('/api/v1/transactions/split')
      .send({ type: 'expense', accountId: bank, date: new Date().toISOString(), description: 'x', parts: [{ categoryId: expenseCategory, amountMinor: rupees(100) }] })
      .expect(422);
  });

  it('rolls back every part if one part is invalid — no partial split is ever posted', async () => {
    await as(user)
      .post('/api/v1/transactions/split')
      .send({
        type: 'expense',
        accountId: bank,
        date: new Date().toISOString(),
        description: 'Bad split',
        parts: [
          { categoryId: expenseCategory, amountMinor: rupees(100) },
          { categoryId: '000000000000000000000000', amountMinor: rupees(50) }, // nonexistent category
        ],
      })
      .expect(404);

    const list = await as(user).get('/api/v1/transactions').expect(200);
    expect(list.body.data.items).toHaveLength(0);
    const account = await as(user).get(`/api/v1/accounts/${bank}`).expect(200);
    expect(account.body.data.balanceMinor).toBe(rupees(50_000));
  });
});

describe('expense groups', () => {
  let alice: string;
  let bob: string;
  let groupId: string;

  beforeEach(async () => {
    alice = (await as(user).post('/api/v1/people').send({ name: 'Alice' }).expect(201)).body.data.id;
    bob = (await as(user).post('/api/v1/people').send({ name: 'Bob' }).expect(201)).body.data.id;
    groupId = (await as(user).post('/api/v1/groups').send({ name: 'Goa Trip', memberPersonIds: [alice, bob] }).expect(201)).body.data.id;
  });

  it('splits a paid expense equally: one expense for my share, one lend per member', async () => {
    await as(user)
      .post(`/api/v1/groups/${groupId}/expenses`)
      .send({
        description: 'Dinner',
        date: new Date().toISOString(),
        accountId: bank,
        categoryId: expenseCategory,
        splitMethod: 'equal',
        totalAmountMinor: rupees(3_000),
        participants: [{ personId: null }, { personId: alice }, { personId: bob }],
      })
      .expect(201);

    const account = await as(user).get(`/api/v1/accounts/${bank}`).expect(200);
    expect(account.body.data.balanceMinor).toBe(rupees(50_000) - rupees(3_000));

    const aliceLedger = await as(user).get(`/api/v1/people/${alice}/ledger`).expect(200);
    expect(aliceLedger.body.data.summary.outstandingMinor).toBe(rupees(1_000));
    const bobLedger = await as(user).get(`/api/v1/people/${bob}/ledger`).expect(200);
    expect(bobLedger.body.data.summary.outstandingMinor).toBe(rupees(1_000));

    const balances = await as(user).get(`/api/v1/groups/${groupId}/balances`).expect(200);
    expect(balances.body.data.sort((a: { personName: string }, b: { personName: string }) => a.personName.localeCompare(b.personName))).toEqual([
      { personId: alice, personName: 'Alice', outstandingMinor: rupees(1_000) },
      { personId: bob, personName: 'Bob', outstandingMinor: rupees(1_000) },
    ]);
  });

  it('splits by percentage and by exact amounts, both summing exactly to the total', async () => {
    await as(user)
      .post(`/api/v1/groups/${groupId}/expenses`)
      .send({
        description: 'Cab fare', date: new Date().toISOString(), accountId: bank,
        splitMethod: 'percentage', totalAmountMinor: rupees(1_000),
        participants: [{ personId: null, value: 50 }, { personId: alice, value: 30 }, { personId: bob, value: 20 }],
      })
      .expect(201);

    expect((await as(user).get(`/api/v1/people/${alice}/ledger`).expect(200)).body.data.summary.outstandingMinor).toBe(rupees(300));
    expect((await as(user).get(`/api/v1/people/${bob}/ledger`).expect(200)).body.data.summary.outstandingMinor).toBe(rupees(200));

    await as(user)
      .post(`/api/v1/groups/${groupId}/expenses`)
      .send({
        description: 'Groceries', date: new Date().toISOString(), accountId: bank,
        splitMethod: 'exact', totalAmountMinor: rupees(900),
        participants: [{ personId: null, value: rupees(400) }, { personId: alice, value: rupees(500) }],
      })
      .expect(201);

    expect((await as(user).get(`/api/v1/people/${alice}/ledger`).expect(200)).body.data.summary.outstandingMinor).toBe(rupees(800)); // 300 + 500
  });

  it('refuses an exact split that does not sum to the stated total', async () => {
    await as(user)
      .post(`/api/v1/groups/${groupId}/expenses`)
      .send({
        description: 'Bad split', date: new Date().toISOString(), accountId: bank,
        splitMethod: 'exact', totalAmountMinor: rupees(1_000),
        participants: [{ personId: null, value: rupees(400) }, { personId: alice, value: rupees(500) }], // sums to 900, not 1000
      })
      .expect(400);
  });

  it('refuses a participant who is not a member of the group', async () => {
    const carol = (await as(user).post('/api/v1/people').send({ name: 'Carol' }).expect(201)).body.data.id;
    await as(user)
      .post(`/api/v1/groups/${groupId}/expenses`)
      .send({
        description: 'Not a member', date: new Date().toISOString(), accountId: bank,
        splitMethod: 'equal', totalAmountMinor: rupees(100),
        participants: [{ personId: null }, { personId: carol }],
      })
      .expect(400);
  });

  it('deleting a group expense deletes the transactions it created, restoring every balance', async () => {
    await as(user)
      .post(`/api/v1/groups/${groupId}/expenses`)
      .send({
        description: 'Dinner', date: new Date().toISOString(), accountId: bank, categoryId: expenseCategory,
        splitMethod: 'equal', totalAmountMinor: rupees(3_000),
        participants: [{ personId: null }, { personId: alice }, { personId: bob }],
      })
      .expect(201);

    const expenses = await as(user).get(`/api/v1/groups/${groupId}/expenses`).expect(200);
    expect(expenses.body.data).toHaveLength(1);

    await as(user).delete(`/api/v1/groups/${groupId}/expenses/${expenses.body.data[0].id}`).expect(200);

    const account = await as(user).get(`/api/v1/accounts/${bank}`).expect(200);
    expect(account.body.data.balanceMinor).toBe(rupees(50_000));
    expect((await as(user).get(`/api/v1/people/${alice}/ledger`).expect(200)).body.data.summary.outstandingMinor).toBe(0);
    expect((await as(user).get(`/api/v1/groups/${groupId}/expenses`).expect(200)).body.data).toHaveLength(0);
  });

  it('never leaks another workspace\'s groups, and refuses a member from a different workspace', async () => {
    const other = await createTestUser();
    await as(other).get(`/api/v1/groups/${groupId}`).expect(404);
    await as(other).get(`/api/v1/groups/${groupId}/balances`).expect(404);

    await as(other)
      .post('/api/v1/groups')
      .send({ name: 'Cross-workspace', memberPersonIds: [alice] }) // alice belongs to `user`, not `other`
      .expect(404);
  });
});
