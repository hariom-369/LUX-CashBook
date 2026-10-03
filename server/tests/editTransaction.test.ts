import { beforeEach, describe, expect, it } from 'vitest';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Phase 2, closing audit finding U-6 (transactions had no in-app edit UI).
 * The service and `rev` support already had coverage (tests/ledger.test.ts,
 * tests/security.test.ts's concurrency block) for amount and account changes;
 * these cover the remaining fields the new edit form sends.
 */

let user: TestUser;
let cash: string;
let bank: string;
let expenseCategory: string;
let incomeCategory: string;

beforeEach(async () => {
  user = await createTestUser();
  cash = (await as(user).post('/api/v1/accounts').send({ name: 'My Wallet', type: 'cash', openingBalanceMinor: rupees(10_000) }).expect(201)).body.data.id;
  bank = (await as(user).post('/api/v1/accounts').send({ name: 'Bank', type: 'bank', openingBalanceMinor: rupees(50_000) }).expect(201)).body.data.id;
  expenseCategory = (await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id;
  incomeCategory = (await as(user).get('/api/v1/categories?kind=income&flat=true').expect(200)).body.data[0].id;
});

describe('editing a transaction — remaining fields', () => {
  it('updates description, tags, reference and payment method', async () => {
    const created = await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(500), date: new Date().toISOString(), accountId: cash, categoryId: expenseCategory, description: 'Lunch' })
      .expect(201);

    const updated = await as(user)
      .patch(`/api/v1/transactions/${created.body.data.id}`)
      .send({
        rev: created.body.data.rev,
        description: 'Lunch with team',
        tags: ['work', 'reimbursable'],
        referenceNo: 'INV-42',
        paymentMethod: 'upi',
      })
      .expect(200);

    expect(updated.body.data.description).toBe('Lunch with team');
    expect(updated.body.data.tags.sort()).toEqual(['reimbursable', 'work']);
    expect(updated.body.data.referenceNo).toBe('INV-42');
    expect(updated.body.data.paymentMethod).toBe('upi');
  });

  it('clears the category by sending null', async () => {
    const created = await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(500), date: new Date().toISOString(), accountId: cash, categoryId: expenseCategory })
      .expect(201);
    expect(created.body.data.categoryId).toBe(expenseCategory);

    const updated = await as(user)
      .patch(`/api/v1/transactions/${created.body.data.id}`)
      .send({ categoryId: null })
      .expect(200);
    expect(updated.body.data.categoryId).toBeUndefined();
  });

  it('changes the category, respecting income/expense kind', async () => {
    const created = await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'income', amountMinor: rupees(1_000), date: new Date().toISOString(), accountId: cash, categoryId: incomeCategory })
      .expect(201);

    // Wrong kind is refused.
    await as(user).patch(`/api/v1/transactions/${created.body.data.id}`).send({ categoryId: expenseCategory }).expect(400);
  });

  it('updates the due date on a loan', async () => {
    const person = (await as(user).post('/api/v1/people').send({ name: 'Rahul' }).expect(201)).body.data.id;
    const dueDate = new Date(Date.now() + 5 * 86_400_000);
    const lent = await as(user)
      .post(`/api/v1/people/${person}/lend`)
      .send({ amountMinor: rupees(2_000), accountId: cash, dueDate: dueDate.toISOString() })
      .expect(201);

    const newDue = new Date(Date.now() + 10 * 86_400_000);
    const updated = await as(user)
      .patch(`/api/v1/transactions/${lent.body.data.id}`)
      .send({ dueDate: newDue.toISOString() })
      .expect(200);
    expect(new Date(updated.body.data.dueDate).toDateString()).toBe(newDue.toDateString());
  });

  it('moves both legs of a transfer when the accounts change', async () => {
    const third = (await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'wallet', openingBalanceMinor: 0 }).expect(201)).body.data.id;
    const created = await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'transfer', amountMinor: rupees(1_000), date: new Date().toISOString(), accountId: cash, toAccountId: bank })
      .expect(201);

    await as(user)
      .patch(`/api/v1/transactions/${created.body.data.id}`)
      .send({ accountId: cash, toAccountId: third })
      .expect(200);

    const cashRes = await as(user).get(`/api/v1/accounts/${cash}`).expect(200);
    const bankRes = await as(user).get(`/api/v1/accounts/${bank}`).expect(200);
    const walletRes = await as(user).get(`/api/v1/accounts/${third}`).expect(200);
    expect(cashRes.body.data.balanceMinor).toBe(rupees(9_000)); // still debited once
    expect(bankRes.body.data.balanceMinor).toBe(rupees(50_000)); // reverted
    expect(walletRes.body.data.balanceMinor).toBe(rupees(1_000)); // now credited
  });

  it('refuses to reassign the person or change the type', async () => {
    const person = (await as(user).post('/api/v1/people').send({ name: 'Rahul' }).expect(201)).body.data.id;
    const other = (await as(user).post('/api/v1/people').send({ name: 'Amit' }).expect(201)).body.data.id;
    const lent = await as(user).post(`/api/v1/people/${person}/lend`).send({ amountMinor: rupees(500), accountId: cash }).expect(201);
    const id = lent.body.data.id;

    // Neither field is in the update schema — sending them is either dropped or rejected;
    // either way, the person on record must never change.
    await as(user).patch(`/api/v1/transactions/${id}`).send({ personId: other, type: 'expense' });

    const after = await as(user).get(`/api/v1/transactions/${id}`).expect(200);
    expect(after.body.data.personId).toBe(person);
    expect(after.body.data.type).toBe('lend');
  });
});
