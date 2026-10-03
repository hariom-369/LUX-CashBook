import { beforeEach, describe, expect, it } from 'vitest';
import { as, anon, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Payees (docs/PRODUCT_AUDIT.md finding D-5, docs/FEATURE_ROADMAP.md decision 3):
 * a merchant/counterparty, deliberately separate from `Person` — a `Person`
 * carries a lending balance and a payee never should.
 */

let user: TestUser;
let cash: string;
let expenseCategory: string;

beforeEach(async () => {
  user = await createTestUser();
  cash = (await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(10_000) }).expect(201)).body.data.id;
  expenseCategory = (await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id;
});

describe('payees CRUD', () => {
  it('creates, lists, updates and archives-or-deletes a payee', async () => {
    const created = await as(user)
      .post('/api/v1/payees')
      .send({ name: 'Jio', defaultCategoryId: expenseCategory, tags: ['telecom'] })
      .expect(201);
    expect(created.body.data.name).toBe('Jio');
    expect(created.body.data.tags).toEqual(['telecom']);

    const list = await as(user).get('/api/v1/payees').expect(200);
    expect(list.body.data.map((p: { name: string }) => p.name)).toContain('Jio');

    const updated = await as(user).patch(`/api/v1/payees/${created.body.data.id}`).send({ name: 'Jio Telecom' }).expect(200);
    expect(updated.body.data.name).toBe('Jio Telecom');

    // Unused — hard delete.
    const removed = await as(user).delete(`/api/v1/payees/${created.body.data.id}`).expect(200);
    expect(removed.body.data).toEqual({ archived: false, deleted: true, transactionCount: 0 });
  });

  it('rejects a duplicate name (case-insensitive), and refuses an unknown-workspace payee', async () => {
    await as(user).post('/api/v1/payees').send({ name: 'Swiggy' }).expect(201);
    const dup = await as(user).post('/api/v1/payees').send({ name: 'swiggy' }).expect(409);
    expect(dup.body.error.code).toBe('DUPLICATE_PAYEE');
  });

  it('archives instead of deleting a payee with transactions, and blocks re-adding the same name meanwhile', async () => {
    const payee = await as(user).post('/api/v1/payees').send({ name: 'Amazon' }).expect(201);
    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(500), date: new Date().toISOString(), accountId: cash, categoryId: expenseCategory, payeeId: payee.body.data.id })
      .expect(201);

    const removed = await as(user).delete(`/api/v1/payees/${payee.body.data.id}`).expect(200);
    expect(removed.body.data).toEqual({ archived: true, deleted: false, transactionCount: 1 });

    const list = await as(user).get('/api/v1/payees').expect(200);
    expect(list.body.data.map((p: { name: string }) => p.name)).not.toContain('Amazon');
    const withArchived = await as(user).get('/api/v1/payees?includeArchived=true').expect(200);
    expect(withArchived.body.data.map((p: { name: string }) => p.name)).toContain('Amazon');
  });

  it('never leaks payees, or another workspace/user\'s payee by id, across users', async () => {
    const other = await createTestUser();
    const mine = await as(user).post('/api/v1/payees').send({ name: 'Only mine' }).expect(201);

    const otherList = await as(other).get('/api/v1/payees').expect(200);
    expect(otherList.body.data).toHaveLength(0);

    await as(other).patch(`/api/v1/payees/${mine.body.data.id}`).send({ name: 'Hijacked' }).expect(404);
    await as(other).delete(`/api/v1/payees/${mine.body.data.id}`).expect(404);
  });

  it('requires authentication', async () => {
    await anon().get('/api/v1/payees').expect(401);
  });
});

describe('payees linked to transactions', () => {
  it('records the payee on a transaction and returns its name', async () => {
    const payee = await as(user).post('/api/v1/payees').send({ name: 'Zomato' }).expect(201);
    const txn = await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(300), date: new Date().toISOString(), accountId: cash, categoryId: expenseCategory, payeeId: payee.body.data.id })
      .expect(201);

    expect(txn.body.data.payeeId).toBe(payee.body.data.id);
    expect(txn.body.data.payeeName).toBe('Zomato');
  });

  it('bumps lastUsedAt on the payee when a transaction is recorded against it', async () => {
    const payee = await as(user).post('/api/v1/payees').send({ name: 'Uber' }).expect(201);
    expect(payee.body.data.lastUsedAt).toBeUndefined();

    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(200), date: new Date().toISOString(), accountId: cash, categoryId: expenseCategory, payeeId: payee.body.data.id })
      .expect(201);

    const list = await as(user).get('/api/v1/payees').expect(200);
    const found = list.body.data.find((p: { id: string }) => p.id === payee.body.data.id);
    expect(found.lastUsedAt).toBeDefined();
  });

  it('sets and clears the payee via an edit', async () => {
    const payee = await as(user).post('/api/v1/payees').send({ name: 'Netflix' }).expect(201);
    const txn = await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(650), date: new Date().toISOString(), accountId: cash, categoryId: expenseCategory })
      .expect(201);
    expect(txn.body.data.payeeId).toBeUndefined();

    const updated = await as(user).patch(`/api/v1/transactions/${txn.body.data.id}`).send({ payeeId: payee.body.data.id }).expect(200);
    expect(updated.body.data.payeeId).toBe(payee.body.data.id);

    const cleared = await as(user).patch(`/api/v1/transactions/${txn.body.data.id}`).send({ payeeId: null }).expect(200);
    expect(cleared.body.data.payeeId).toBeUndefined();
  });

  it('refuses a payeeId from a different workspace', async () => {
    const other = await createTestUser();
    const otherPayee = await as(other).post('/api/v1/payees').send({ name: 'Not yours' }).expect(201);

    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(100), date: new Date().toISOString(), accountId: cash, categoryId: expenseCategory, payeeId: otherPayee.body.data.id })
      .expect(404);
  });

  it('filters the transaction list by payeeIds', async () => {
    const a = await as(user).post('/api/v1/payees').send({ name: 'Payee A' }).expect(201);
    const b = await as(user).post('/api/v1/payees').send({ name: 'Payee B' }).expect(201);
    await as(user).post('/api/v1/transactions').send({ type: 'expense', amountMinor: rupees(10), date: new Date().toISOString(), accountId: cash, categoryId: expenseCategory, payeeId: a.body.data.id }).expect(201);
    await as(user).post('/api/v1/transactions').send({ type: 'expense', amountMinor: rupees(20), date: new Date().toISOString(), accountId: cash, categoryId: expenseCategory, payeeId: b.body.data.id }).expect(201);

    const filtered = await as(user).get(`/api/v1/transactions?payeeIds=${a.body.data.id}`).expect(200);
    expect(filtered.body.data.total).toBe(1);
    expect(filtered.body.data.items[0].payeeId).toBe(a.body.data.id);
  });
});
