import { beforeEach, describe, expect, it } from 'vitest';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Account reconciliation (docs/ROADMAP_PHASE5_NOTES.md): compare Khata's own
 * balance with a real bank statement and post the gap as an `adjustment`
 * transaction — the same mechanism Daily Closing already uses — never a
 * silent change to the cached balance.
 */

let user: TestUser;
let bank: string;

beforeEach(async () => {
  user = await createTestUser();
  bank = (await as(user).post('/api/v1/accounts').send({ name: 'Bank', type: 'bank', openingBalanceMinor: rupees(10_000) }).expect(201)).body.data.id;
});

describe('account reconciliation', () => {
  it('previews a zero difference without posting anything', async () => {
    const preview = await as(user).get(`/api/v1/accounts/${bank}/reconcile/preview?statementBalanceMinor=${rupees(10_000)}`).expect(200);
    expect(preview.body.data).toEqual({ ledgerBalanceMinor: rupees(10_000), statementBalanceMinor: rupees(10_000), differenceMinor: 0 });

    const result = await as(user).post(`/api/v1/accounts/${bank}/reconcile`).send({ statementBalanceMinor: rupees(10_000) }).expect(200);
    expect(result.body.data.differenceMinor).toBe(0);
    expect(result.body.data.adjustmentTransactionId).toBeUndefined();

    const account = await as(user).get(`/api/v1/accounts/${bank}`).expect(200);
    expect(account.body.data.balanceMinor).toBe(rupees(10_000));
  });

  it('posts an "in" adjustment when the statement balance is higher, and raises it exactly once', async () => {
    const result = await as(user).post(`/api/v1/accounts/${bank}/reconcile`).send({ statementBalanceMinor: rupees(10_500), note: 'Bank interest I missed' }).expect(200);
    expect(result.body.data.differenceMinor).toBe(rupees(500));
    expect(result.body.data.adjustmentTransactionId).toBeTruthy();

    const account = await as(user).get(`/api/v1/accounts/${bank}`).expect(200);
    expect(account.body.data.balanceMinor).toBe(rupees(10_500));

    const adjustment = await as(user).get(`/api/v1/transactions/${result.body.data.adjustmentTransactionId}`).expect(200);
    expect(adjustment.body.data.type).toBe('adjustment');
    expect(adjustment.body.data.description).toBe('Bank interest I missed');
  });

  it('posts an "out" adjustment when the statement balance is lower', async () => {
    const result = await as(user).post(`/api/v1/accounts/${bank}/reconcile`).send({ statementBalanceMinor: rupees(9_000) }).expect(200);
    expect(result.body.data.differenceMinor).toBe(-rupees(1_000));

    const account = await as(user).get(`/api/v1/accounts/${bank}`).expect(200);
    expect(account.body.data.balanceMinor).toBe(rupees(9_000));
  });

  it('never reconciles another workspace\'s account', async () => {
    const other = await createTestUser();
    await as(other).get(`/api/v1/accounts/${bank}/reconcile/preview?statementBalanceMinor=${rupees(0)}`).expect(404);
    await as(other).post(`/api/v1/accounts/${bank}/reconcile`).send({ statementBalanceMinor: rupees(0) }).expect(404);
  });
});
