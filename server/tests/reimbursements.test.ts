import { beforeEach, describe, expect, it } from 'vitest';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Reimbursement tracking (§Phase 7): pending -> submitted -> approved -> paid on an expense, with the
 * payout linked back. It is bookkeeping about a claim - it must never change the expense, a balance
 * or the income/expense totals.
 */

let user: TestUser;
let wallet: string;
let expenseCat: string;
let incomeCat: string;

const expense = async (amount = 1_200, description = 'Client lunch') =>
  (
    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(amount), accountId: wallet, categoryId: expenseCat, date: new Date().toISOString(), description })
      .expect(201)
  ).body.data as { id: string; rev: number };
const income = async (amount = 1_200) =>
  (
    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'income', amountMinor: rupees(amount), accountId: wallet, categoryId: incomeCat, date: new Date().toISOString(), description: 'Reimbursement' })
      .expect(201)
  ).body.data.id as string;
const claim = (id: string, body: Record<string, unknown>) => as(user).patch(`/api/v1/transactions/${id}/reimbursement`).send(body);
const get = async (id: string) => (await as(user).get(`/api/v1/transactions/${id}`).expect(200)).body.data;

beforeEach(async () => {
  user = await createTestUser();
  wallet = (await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(50_000) }).expect(201)).body.data.id;
  expenseCat = (await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id;
  incomeCat = (await as(user).get('/api/v1/categories?kind=income&flat=true').expect(200)).body.data[0].id;
});

describe('the claim workflow', () => {
  it('moves pending -> submitted -> approved -> paid, one stage at a time', async () => {
    const { id } = await expense();
    expect((await claim(id, { status: 'pending' }).expect(200)).body.data.reimbursement.status).toBe('pending');
    expect((await claim(id, { status: 'submitted' }).expect(200)).body.data.reimbursement.status).toBe('submitted');
    expect((await claim(id, { status: 'approved' }).expect(200)).body.data.reimbursement.status).toBe('approved');
    const paid = (await claim(id, { status: 'paid' }).expect(200)).body.data;
    expect(paid.reimbursement.status).toBe('paid');
    expect(paid.reimbursement.payoutTransactionId).toBeUndefined();
  });

  it('refuses a jump, and refuses to start anywhere but pending', async () => {
    const { id } = await expense();
    const start = await claim(id, { status: 'approved' });
    expect(start.status).toBe(422);
    expect(start.body.error.code).toBe('INVALID_REIMBURSEMENT_STEP');
    await claim(id, { status: 'pending' }).expect(200);
    expect((await claim(id, { status: 'paid' })).status).toBe(422);
  });

  it('allows one step back to fix a slip, and "none" to stop tracking from any stage', async () => {
    const { id } = await expense();
    await claim(id, { status: 'pending' }).expect(200);
    await claim(id, { status: 'submitted' }).expect(200);
    expect((await claim(id, { status: 'pending' }).expect(200)).body.data.reimbursement.status).toBe('pending');
    await claim(id, { status: 'submitted' }).expect(200);
    await claim(id, { status: 'none' }).expect(200);
    expect((await get(id)).reimbursement).toBeUndefined();
  });

  it('only an expense can be tracked', async () => {
    const inc = await income();
    expect((await claim(inc, { status: 'pending' })).status).toBe(400);
  });

  it('uses rev, so a stale editor is told the entry changed', async () => {
    const { id, rev } = await expense();
    await claim(id, { status: 'pending', rev }).expect(200);
    const stale = await claim(id, { status: 'submitted', rev });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_REVISION');
  });

  it('is refused for a deleted expense', async () => {
    const { id } = await expense();
    await as(user).delete(`/api/v1/transactions/${id}`).expect(200);
    await claim(id, { status: 'pending' }).expect(404);
  });
});

describe('linking the payout', () => {
  async function approved() {
    const { id } = await expense();
    for (const status of ['pending', 'submitted', 'approved']) await claim(id, { status }).expect(200);
    return id;
  }

  it('links the income entry the money arrived as', async () => {
    const id = await approved();
    const payout = await income();
    const res = (await claim(id, { status: 'paid', payoutTransactionId: payout }).expect(200)).body.data;
    expect(res.reimbursement.payoutTransactionId).toBe(payout);
  });

  it('refuses a payout that is not an income entry, or is already linked to another claim', async () => {
    const id = await approved();
    const other = (await expense(50, 'Other')).id;
    expect((await claim(id, { status: 'paid', payoutTransactionId: other })).status).toBe(400);

    const payout = await income();
    await claim(id, { status: 'paid', payoutTransactionId: payout }).expect(200);
    const second = (await expense(10, 'Second')).id;
    for (const status of ['pending', 'submitted', 'approved']) await claim(second, { status }).expect(200);
    const dupe = await claim(second, { status: 'paid', payoutTransactionId: payout });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe('PAYOUT_ALREADY_LINKED');
  });

  it('refuses a payout from another workspace', async () => {
    const id = await approved();
    const stranger = await createTestUser();
    const theirWallet = (await as(stranger).post('/api/v1/accounts').send({ name: 'W', type: 'cash', openingBalanceMinor: 0 }).expect(201)).body.data.id;
    const theirCat = (await as(stranger).get('/api/v1/categories?kind=income&flat=true').expect(200)).body.data[0].id;
    const foreign = (
      await as(stranger).post('/api/v1/transactions').send({ type: 'income', amountMinor: 100, accountId: theirWallet, categoryId: theirCat, date: new Date().toISOString() }).expect(201)
    ).body.data.id;
    await claim(id, { status: 'paid', payoutTransactionId: foreign }).expect(404);
  });

  it('drops the link when the claim is moved back from paid', async () => {
    const id = await approved();
    const payout = await income();
    await claim(id, { status: 'paid', payoutTransactionId: payout }).expect(200);
    const back = (await claim(id, { status: 'approved' }).expect(200)).body.data;
    expect(back.reimbursement.payoutTransactionId).toBeUndefined();
  });
});

describe('it is only bookkeeping', () => {
  it('never changes the expense, the account balance or the income and expense totals', async () => {
    const { id } = await expense(1_200);
    const payout = await income(1_200);
    const snapshot = async () => ({
      balance: (await as(user).get(`/api/v1/accounts/${wallet}`).expect(200)).body.data.balanceMinor,
      txn: (await get(id)) as { amountMinor: number; categoryId: string; description: string },
      totals: (await as(user).get('/api/v1/dashboard').expect(200)).body.data.month,
    });
    const before = await snapshot();
    for (const status of ['pending', 'submitted', 'approved']) await claim(id, { status }).expect(200);
    await claim(id, { status: 'paid', payoutTransactionId: payout }).expect(200);
    const after = await snapshot();

    expect(after.balance).toBe(before.balance);
    expect(after.txn.amountMinor).toBe(before.txn.amountMinor);
    expect(after.txn.categoryId).toBe(before.txn.categoryId);
    expect(after.totals.expenseMinor).toBe(before.totals.expenseMinor);
    expect(after.totals.incomeMinor).toBe(before.totals.incomeMinor);
  });
});

describe('summary and filter', () => {
  it('totals what is still owed, by stage', async () => {
    const a = (await expense(100, 'A')).id;
    const b = (await expense(200, 'B')).id;
    const c = (await expense(400, 'C')).id;
    await expense(999, 'Untracked');
    await claim(a, { status: 'pending' }).expect(200);
    await claim(b, { status: 'pending' }).expect(200);
    await claim(b, { status: 'submitted' }).expect(200);
    for (const status of ['pending', 'submitted', 'approved', 'paid']) await claim(c, { status }).expect(200);

    const summary = (await as(user).get('/api/v1/transactions/reimbursements/summary').expect(200)).body.data;
    expect(summary.outstandingMinor).toBe(rupees(300)); // A + B; C is paid
    const by = Object.fromEntries(summary.byStatus.map((s: { status: string; count: number; amountMinor: number }) => [s.status, s]));
    expect(by.pending).toMatchObject({ count: 1, amountMinor: rupees(100) });
    expect(by.submitted).toMatchObject({ count: 1, amountMinor: rupees(200) });
    expect(by.paid).toMatchObject({ count: 1, amountMinor: rupees(400) });
    expect(by.approved).toMatchObject({ count: 0, amountMinor: 0 });
  });

  it('filters the transaction list by stage', async () => {
    const a = (await expense(100, 'A')).id;
    const b = (await expense(200, 'B')).id;
    await claim(a, { status: 'pending' }).expect(200);
    await claim(b, { status: 'pending' }).expect(200);
    await claim(b, { status: 'submitted' }).expect(200);
    const list = (await as(user).get('/api/v1/transactions?reimbursement=submitted').expect(200)).body.data.items as Array<{ description: string }>;
    expect(list.map((t) => t.description)).toEqual(['B']);
    const both = (await as(user).get('/api/v1/transactions?reimbursement=pending,submitted').expect(200)).body.data.items as unknown[];
    expect(both).toHaveLength(2);
  });

  it("is isolated per workspace", async () => {
    const { id } = await expense();
    await claim(id, { status: 'pending' }).expect(200);
    const other = await createTestUser();
    const summary = (await as(other).get('/api/v1/transactions/reimbursements/summary').expect(200)).body.data;
    expect(summary.outstandingMinor).toBe(0);
    await as(other).patch(`/api/v1/transactions/${id}/reimbursement`).send({ status: 'submitted' }).expect(404);
  });
});
