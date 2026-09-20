import { beforeEach, describe, expect, it } from 'vitest';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * The arithmetic tests.
 *
 * If anything in this file fails, the application is not fit to hold someone's
 * money. Every assertion here is about a number being exactly right — not close,
 * not eventually — which is why they assert on integer minor units rather than
 * formatted strings.
 */

let user: TestUser;
let cash: string;
let bank: string;
let upi: string;

async function createAccount(name: string, type: string, openingRupees = 0): Promise<string> {
  const response = await as(user)
    .post('/api/v1/accounts')
    .send({ name, type, openingBalanceMinor: rupees(openingRupees) })
    .expect(201);
  return response.body.data.id;
}

async function balanceOf(accountId: string): Promise<number> {
  const response = await as(user).get(`/api/v1/accounts/${accountId}`).expect(200);
  return response.body.data.balanceMinor;
}

async function expenseCategory(): Promise<string> {
  const response = await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200);
  return response.body.data[0].id;
}

async function incomeCategory(): Promise<string> {
  const response = await as(user).get('/api/v1/categories?kind=income&flat=true').expect(200);
  return response.body.data[0].id;
}

beforeEach(async () => {
  user = await createTestUser();
  // The workspace is seeded with a "Cash" account; these are the ones the tests drive.
  cash = await createAccount('Wallet', 'cash', 10_000);
  bank = await createAccount('SBI', 'bank', 50_000);
  upi = await createAccount('UPI', 'upi', 5_000);
});

describe('opening balances', () => {
  it('starts each account at its opening balance', async () => {
    expect(await balanceOf(cash)).toBe(rupees(10_000));
    expect(await balanceOf(bank)).toBe(rupees(50_000));
    expect(await balanceOf(upi)).toBe(rupees(5_000));
  });

  it('does not record an opening balance as income', async () => {
    const response = await as(user).get('/api/v1/dashboard').expect(200);
    expect(response.body.data.month.incomeMinor).toBe(0);
    expect(response.body.data.month.expenseMinor).toBe(0);
  });
});

describe('income and expense', () => {
  it('increases the balance for income and decreases it for an expense', async () => {
    await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'income',
        amountMinor: rupees(5_000),
        date: new Date().toISOString(),
        accountId: cash,
        categoryId: await incomeCategory(),
        description: 'Freelance work',
      })
      .expect(201);

    expect(await balanceOf(cash)).toBe(rupees(15_000));

    await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'expense',
        amountMinor: rupees(2_000),
        date: new Date().toISOString(),
        accountId: cash,
        categoryId: await expenseCategory(),
        description: 'Groceries',
      })
      .expect(201);

    expect(await balanceOf(cash)).toBe(rupees(13_000));
  });

  it('rejects a zero or negative amount', async () => {
    for (const amountMinor of [0, -100]) {
      await as(user)
        .post('/api/v1/transactions')
        .send({ type: 'expense', amountMinor, date: new Date().toISOString(), accountId: cash })
        .expect(422);
    }
  });

  it('rejects a fractional amount rather than rounding it', async () => {
    // 10.5 paise is a client bug; silently rounding it would put a wrong number in
    // the ledger and hide the bug.
    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: 10.5, date: new Date().toISOString(), accountId: cash })
      .expect(422);
  });

  it('refuses an income category on an expense', async () => {
    await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'expense',
        amountMinor: rupees(100),
        date: new Date().toISOString(),
        accountId: cash,
        categoryId: await incomeCategory(),
      })
      .expect(400);
  });
});

/**
 * The scenario named in the specification (§68).
 *
 *   start 10,000 · expense 2,000 · income 5,000 · transfer 3,000 A→B
 *   → combined balance 13,000, and the transfer changes nothing about that.
 */
describe('the specification scenario', () => {
  it('ends at ₹13,000 combined, with the transfer changing nothing', async () => {
    const a = await createAccount('Account A', 'bank', 10_000);
    const b = await createAccount('Account B', 'bank', 0);

    const startTotal = (await balanceOf(a)) + (await balanceOf(b));
    expect(startTotal).toBe(rupees(10_000));

    await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'expense',
        amountMinor: rupees(2_000),
        date: new Date().toISOString(),
        accountId: a,
        categoryId: await expenseCategory(),
      })
      .expect(201);

    await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'income',
        amountMinor: rupees(5_000),
        date: new Date().toISOString(),
        accountId: a,
        categoryId: await incomeCategory(),
      })
      .expect(201);

    const beforeTransfer = (await balanceOf(a)) + (await balanceOf(b));
    expect(beforeTransfer).toBe(rupees(13_000));

    await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'transfer',
        amountMinor: rupees(3_000),
        date: new Date().toISOString(),
        accountId: a,
        toAccountId: b,
      })
      .expect(201);

    expect(await balanceOf(a)).toBe(rupees(10_000));
    expect(await balanceOf(b)).toBe(rupees(3_000));

    // The headline assertion: a transfer moves money without creating or
    // destroying any (invariant I4).
    expect((await balanceOf(a)) + (await balanceOf(b))).toBe(rupees(13_000));
  });
});

describe('transfers', () => {
  it('never counts as income, expense or savings (invariant I5)', async () => {
    await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'income',
        amountMinor: rupees(20_000),
        date: new Date().toISOString(),
        accountId: bank,
        categoryId: await incomeCategory(),
      })
      .expect(201);

    const before = await as(user).get('/api/v1/dashboard').expect(200);

    await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'transfer',
        amountMinor: rupees(10_000),
        date: new Date().toISOString(),
        accountId: bank,
        toAccountId: cash,
      })
      .expect(201);

    const after = await as(user).get('/api/v1/dashboard').expect(200);

    expect(after.body.data.month.incomeMinor).toBe(before.body.data.month.incomeMinor);
    expect(after.body.data.month.expenseMinor).toBe(before.body.data.month.expenseMinor);
    expect(after.body.data.month.savingsRate).toBe(before.body.data.month.savingsRate);
    expect(after.body.data.totalBalanceMinor).toBe(before.body.data.totalBalanceMinor);
  });

  it('creates exactly one transaction with two cancelling postings', async () => {
    const response = await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'transfer',
        amountMinor: rupees(10_000),
        date: new Date().toISOString(),
        accountId: cash,
        toAccountId: bank,
      })
      .expect(201);

    const { postings } = response.body.data;
    expect(postings).toHaveLength(2);
    expect(postings[0].amountMinor + postings[1].amountMinor).toBe(0);
    expect(postings.find((p: { amountMinor: number }) => p.amountMinor < 0).accountId).toBe(cash);
    expect(postings.find((p: { amountMinor: number }) => p.amountMinor > 0).accountId).toBe(bank);

    const list = await as(user).get('/api/v1/transactions?types=transfer').expect(200);
    expect(list.body.data.total).toBe(1);
  });

  it('refuses a transfer to the same account', async () => {
    await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'transfer',
        amountMinor: rupees(1_000),
        date: new Date().toISOString(),
        accountId: cash,
        toAccountId: cash,
      })
      .expect(422);
  });
});

describe('lending and borrowing', () => {
  let rahul: string;

  beforeEach(async () => {
    const response = await as(user).post('/api/v1/people').send({ name: 'Rahul' }).expect(201);
    rahul = response.body.data.id;
  });

  it('records a loan without calling it an expense (invariant I6)', async () => {
    await as(user)
      .post(`/api/v1/people/${rahul}/lend`)
      .send({ amountMinor: rupees(10_000), accountId: bank })
      .expect(201);

    // Cash left the account…
    expect(await balanceOf(bank)).toBe(rupees(40_000));

    // …but it is not spending.
    const dashboard = await as(user).get('/api/v1/dashboard').expect(200);
    expect(dashboard.body.data.month.expenseMinor).toBe(0);
    expect(dashboard.body.data.receivables.totalMinor).toBe(rupees(10_000));
  });

  it('tracks partial repayment and never closes early (§16)', async () => {
    await as(user)
      .post(`/api/v1/people/${rahul}/lend`)
      .send({ amountMinor: rupees(10_000), accountId: bank })
      .expect(201);

    await as(user)
      .post(`/api/v1/people/${rahul}/repay`)
      .send({ amountMinor: rupees(3_000), accountId: bank })
      .expect(201);

    const ledger = await as(user).get(`/api/v1/people/${rahul}/ledger`).expect(200);
    expect(ledger.body.data.summary.outstandingMinor).toBe(rupees(7_000));
    expect(ledger.body.data.summary.status).toBe('receivable');
    expect(ledger.body.data.summary.totalGivenMinor).toBe(rupees(10_000));
    expect(ledger.body.data.summary.totalReceivedMinor).toBe(rupees(3_000));

    expect(await balanceOf(bank)).toBe(rupees(43_000));
  });

  it('produces the running balance shown in the person ledger', async () => {
    await as(user)
      .post(`/api/v1/people/${rahul}/lend`)
      .send({ amountMinor: rupees(10_000), accountId: bank, date: '2026-09-01T10:00:00.000Z' })
      .expect(201);

    await as(user)
      .post(`/api/v1/people/${rahul}/repay`)
      .send({ amountMinor: rupees(4_000), accountId: bank, date: '2026-09-10T10:00:00.000Z' })
      .expect(201);

    const ledger = await as(user).get(`/api/v1/people/${rahul}/ledger`).expect(200);
    const rows = ledger.body.data.rows;

    expect(rows).toHaveLength(2);
    expect(rows[0].gaveMinor).toBe(rupees(10_000));
    expect(rows[0].receivedMinor).toBe(0);
    expect(rows[0].balanceMinor).toBe(rupees(10_000));

    expect(rows[1].gaveMinor).toBe(0);
    expect(rows[1].receivedMinor).toBe(rupees(4_000));
    expect(rows[1].balanceMinor).toBe(rupees(6_000));
  });

  it('refuses to repay more than is outstanding', async () => {
    await as(user)
      .post(`/api/v1/people/${rahul}/lend`)
      .send({ amountMinor: rupees(5_000), accountId: bank })
      .expect(201);

    const response = await as(user)
      .post(`/api/v1/people/${rahul}/repay`)
      .send({ amountMinor: rupees(6_000), accountId: bank })
      .expect(422);

    expect(response.body.error.code).toBe('OVER_REPAYMENT');

    // And the failed attempt changed nothing.
    const ledger = await as(user).get(`/api/v1/people/${rahul}/ledger`).expect(200);
    expect(ledger.body.data.summary.outstandingMinor).toBe(rupees(5_000));
  });

  it('refuses a repayment when nothing is owed', async () => {
    await as(user)
      .post(`/api/v1/people/${rahul}/repay`)
      .send({ amountMinor: rupees(1_000), accountId: bank })
      .expect(409);
  });

  it('keeps borrowing separate from income', async () => {
    await as(user)
      .post(`/api/v1/people/${rahul}/borrow`)
      .send({ amountMinor: rupees(5_000), accountId: cash })
      .expect(201);

    expect(await balanceOf(cash)).toBe(rupees(15_000));

    const dashboard = await as(user).get('/api/v1/dashboard').expect(200);
    expect(dashboard.body.data.month.incomeMinor).toBe(0);
    expect(dashboard.body.data.payables.totalMinor).toBe(rupees(5_000));
  });

  it('distinguishes money you will receive from money you owe', async () => {
    const amit = (await as(user).post('/api/v1/people').send({ name: 'Amit' }).expect(201)).body.data.id;

    await as(user)
      .post(`/api/v1/people/${rahul}/lend`)
      .send({ amountMinor: rupees(3_000), accountId: cash })
      .expect(201);
    await as(user)
      .post(`/api/v1/people/${amit}/borrow`)
      .send({ amountMinor: rupees(7_000), accountId: cash })
      .expect(201);

    const summary = await as(user).get('/api/v1/people/summary').expect(200);
    expect(summary.body.data.receivableMinor).toBe(rupees(3_000));
    expect(summary.body.data.payableMinor).toBe(rupees(7_000));
  });

  it('settles an account to exactly zero and keeps the history', async () => {
    await as(user)
      .post(`/api/v1/people/${rahul}/lend`)
      .send({ amountMinor: rupees(10_000), accountId: bank })
      .expect(201);
    await as(user)
      .post(`/api/v1/people/${rahul}/repay`)
      .send({ amountMinor: rupees(4_000), accountId: bank })
      .expect(201);

    const settled = await as(user)
      .post(`/api/v1/people/${rahul}/settle`)
      .send({ accountId: bank })
      .expect(200);

    expect(settled.body.data.settledMinor).toBe(rupees(6_000));
    expect(settled.body.data.person.balanceMinor).toBe(0);

    // Every original row is still there — settling is an entry, not an erasure.
    const ledger = await as(user).get(`/api/v1/people/${rahul}/ledger`).expect(200);
    expect(ledger.body.data.rows).toHaveLength(3);
    expect(ledger.body.data.summary.outstandingMinor).toBe(0);
    expect(ledger.body.data.summary.status).toBe('settled');

    // The money came back to the account it was lent from.
    expect(await balanceOf(bank)).toBe(rupees(50_000));
  });

  it('refuses to delete a person who still owes money', async () => {
    await as(user)
      .post(`/api/v1/people/${rahul}/lend`)
      .send({ amountMinor: rupees(1_000), accountId: cash })
      .expect(201);

    const response = await as(user).delete(`/api/v1/people/${rahul}`).expect(409);
    expect(response.body.error.code).toBe('PERSON_HAS_BALANCE');
  });
});

describe('delete, undo and history', () => {
  it('soft-deletes and reverses the balance, then restores both', async () => {
    const created = await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'expense',
        amountMinor: rupees(2_500),
        date: new Date().toISOString(),
        accountId: cash,
        categoryId: await expenseCategory(),
      })
      .expect(201);

    const id = created.body.data.id;
    expect(await balanceOf(cash)).toBe(rupees(7_500));

    await as(user).delete(`/api/v1/transactions/${id}`).expect(200);
    expect(await balanceOf(cash)).toBe(rupees(10_000));

    // The row still exists — that is what makes undo possible (invariant I7).
    const trash = await as(user).get('/api/v1/transactions?onlyDeleted=true').expect(200);
    expect(trash.body.data.total).toBe(1);

    await as(user).post(`/api/v1/transactions/${id}/restore`).expect(200);
    expect(await balanceOf(cash)).toBe(rupees(7_500));
  });

  it('removes a deleted transaction from totals but keeps it recoverable', async () => {
    const created = await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'income',
        amountMinor: rupees(9_000),
        date: new Date().toISOString(),
        accountId: bank,
        categoryId: await incomeCategory(),
      })
      .expect(201);

    await as(user).delete(`/api/v1/transactions/${created.body.data.id}`).expect(200);

    const dashboard = await as(user).get('/api/v1/dashboard').expect(200);
    expect(dashboard.body.data.month.incomeMinor).toBe(0);

    const detail = await as(user).get(`/api/v1/transactions/${created.body.data.id}`).expect(200);
    expect(detail.body.data.deletedAt).not.toBeNull();
  });

  it('refuses to delete a loan that has repayments against it', async () => {
    const rahul = (await as(user).post('/api/v1/people').send({ name: 'Vikas' }).expect(201)).body.data.id;

    const loan = await as(user)
      .post(`/api/v1/people/${rahul}/lend`)
      .send({ amountMinor: rupees(5_000), accountId: cash })
      .expect(201);

    await as(user)
      .post(`/api/v1/people/${rahul}/repay`)
      .send({ amountMinor: rupees(1_000), accountId: cash })
      .expect(201);

    const response = await as(user).delete(`/api/v1/transactions/${loan.body.data.id}`).expect(409);
    expect(response.body.error.code).toBe('HAS_REPAYMENTS');
  });
});

describe('editing', () => {
  it('reverses the old effect and applies the new one', async () => {
    const created = await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'expense',
        amountMinor: rupees(1_000),
        date: new Date().toISOString(),
        accountId: cash,
        categoryId: await expenseCategory(),
      })
      .expect(201);

    expect(await balanceOf(cash)).toBe(rupees(9_000));

    await as(user)
      .patch(`/api/v1/transactions/${created.body.data.id}`)
      .send({ amountMinor: rupees(2_500) })
      .expect(200);

    expect(await balanceOf(cash)).toBe(rupees(7_500));
  });

  it('moves the money when the account changes', async () => {
    const created = await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'expense',
        amountMinor: rupees(1_000),
        date: new Date().toISOString(),
        accountId: cash,
        categoryId: await expenseCategory(),
      })
      .expect(201);

    await as(user)
      .patch(`/api/v1/transactions/${created.body.data.id}`)
      .send({ accountId: bank })
      .expect(200);

    expect(await balanceOf(cash)).toBe(rupees(10_000));
    expect(await balanceOf(bank)).toBe(rupees(49_000));
  });
});

describe('negative balance protection', () => {
  it('refuses to overdraw a cash account', async () => {
    const drawer = await createAccount('Drawer', 'cash', 1_000);

    const response = await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'expense',
        amountMinor: rupees(2_000),
        date: new Date().toISOString(),
        accountId: drawer,
        categoryId: await expenseCategory(),
      })
      .expect(422);

    expect(response.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await balanceOf(drawer)).toBe(rupees(1_000));
  });

  it('allows a credit card to go negative', async () => {
    const card = await createAccount('Credit Card', 'credit_card', 0);

    await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'expense',
        amountMinor: rupees(15_000),
        date: new Date().toISOString(),
        accountId: card,
        categoryId: await expenseCategory(),
      })
      .expect(201);

    expect(await balanceOf(card)).toBe(rupees(-15_000));
  });
});

describe('idempotency', () => {
  it('returns the original transaction for a repeated submit', async () => {
    const payload = {
      type: 'expense',
      amountMinor: rupees(750),
      date: new Date().toISOString(),
      accountId: cash,
      categoryId: await expenseCategory(),
      idempotencyKey: 'submit-once-abcdef123456',
    };

    const first = await as(user).post('/api/v1/transactions').send(payload).expect(201);
    const second = await as(user).post('/api/v1/transactions').send(payload).expect(201);

    expect(second.body.data.id).toBe(first.body.data.id);
    // And crucially, the money only moved once.
    expect(await balanceOf(cash)).toBe(rupees(9_250));
  });
});

describe('ledger integrity', () => {
  it('reports a clean ledger after a realistic sequence of activity', async () => {
    const person = (await as(user).post('/api/v1/people').send({ name: 'Meena' }).expect(201)).body.data.id;
    const expense = await expenseCategory();
    const income = await incomeCategory();
    const now = new Date().toISOString();

    await as(user).post('/api/v1/transactions').send({ type: 'income', amountMinor: rupees(72_000), date: now, accountId: bank, categoryId: income }).expect(201);
    await as(user).post('/api/v1/transactions').send({ type: 'expense', amountMinor: rupees(12_000), date: now, accountId: bank, categoryId: expense }).expect(201);
    await as(user).post('/api/v1/transactions').send({ type: 'transfer', amountMinor: rupees(10_000), date: now, accountId: bank, toAccountId: cash }).expect(201);
    await as(user).post('/api/v1/transactions').send({ type: 'expense', amountMinor: rupees(3_500), date: now, accountId: cash, categoryId: expense }).expect(201);
    await as(user).post(`/api/v1/people/${person}/lend`).send({ amountMinor: rupees(5_000), accountId: upi }).expect(201);
    await as(user).post(`/api/v1/people/${person}/repay`).send({ amountMinor: rupees(2_000), accountId: cash }).expect(201);

    const integrity = await as(user).get('/api/v1/integrity').expect(200);
    expect(integrity.body.data.issues).toEqual([]);
    expect(integrity.body.data.ok).toBe(true);

    // Independently check the arithmetic the integrity endpoint claims is fine.
    //   bank  50,000 + 72,000 − 12,000 − 10,000 = 100,000
    //   cash  10,000 + 10,000 −  3,500 +  2,000 =  18,500
    //   upi    5,000 −  5,000                   =       0
    expect(await balanceOf(bank)).toBe(rupees(100_000));
    expect(await balanceOf(cash)).toBe(rupees(18_500));
    expect(await balanceOf(upi)).toBe(rupees(0));
  });

  it('detects and repairs a balance that has been tampered with', async () => {
    await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'expense',
        amountMinor: rupees(1_000),
        date: new Date().toISOString(),
        accountId: cash,
        categoryId: await expenseCategory(),
      })
      .expect(201);

    // Corrupt the cache directly, simulating drift from any cause.
    const { Account } = await import('../src/models/index.js');
    await Account.updateOne({ _id: cash }, { $set: { cachedBalanceMinor: rupees(999_999) } });

    const broken = await as(user).get('/api/v1/integrity').expect(200);
    expect(broken.body.data.ok).toBe(false);
    expect(broken.body.data.issues[0].kind).toBe('account_balance');
    expect(broken.body.data.issues[0].expectedMinor).toBe(rupees(9_000));

    const repaired = await as(user).post('/api/v1/integrity/repair').expect(200);
    expect(repaired.body.data.verification.ok).toBe(true);
    expect(await balanceOf(cash)).toBe(rupees(9_000));
  });
});

describe('workspace isolation of financial data', () => {
  it("never exposes another user's transactions, accounts or people", async () => {
    const attacker = await createTestUser();

    await as(user)
      .post('/api/v1/transactions')
      .send({
        type: 'income',
        amountMinor: rupees(99_000),
        date: new Date().toISOString(),
        accountId: bank,
        categoryId: await incomeCategory(),
      })
      .expect(201);

    const transactions = await as(attacker).get('/api/v1/transactions').expect(200);
    expect(transactions.body.data.total).toBe(0);

    const accounts = await as(attacker).get('/api/v1/accounts').expect(200);
    expect(accounts.body.data.map((a: { id: string }) => a.id)).not.toContain(bank);

    // And a direct reference to a known id is refused.
    await as(attacker).get(`/api/v1/accounts/${bank}`).expect(404);
    await as(attacker).get(`/api/v1/accounts/${bank}/ledger`).expect(404);

    const dashboard = await as(attacker).get('/api/v1/dashboard').expect(200);
    expect(dashboard.body.data.month.incomeMinor).toBe(0);
  });

  it("refuses to post a transaction into another user's account", async () => {
    const attacker = await createTestUser();

    await as(attacker)
      .post('/api/v1/transactions')
      .send({ type: 'income', amountMinor: rupees(1_000), date: new Date().toISOString(), accountId: bank })
      .expect(404);

    expect(await balanceOf(bank)).toBe(rupees(50_000));
  });
});
