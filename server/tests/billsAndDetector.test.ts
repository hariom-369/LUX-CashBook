import { beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '@khata/shared';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Phase 3 (docs/ROADMAP_PHASE3_NOTES.md): bills (`billKind` on recurring
 * templates) and the subscription detector, which only ever *suggests* — it
 * never creates or changes a transaction on its own.
 */

let user: TestUser;
let cash: string;
let expenseCategory: string;

beforeEach(async () => {
  user = await createTestUser();
  cash = (await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(50_000) }).expect(201)).body.data.id;
  expenseCategory = (await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id;
});

async function postExpense(daysAgo: number, amountMinor: number, payeeId?: string, description = 'Netflix') {
  await as(user)
    .post('/api/v1/transactions')
    .send({
      type: 'expense',
      amountMinor,
      date: addDays(new Date(), -daysAgo).toISOString(),
      accountId: cash,
      categoryId: expenseCategory,
      payeeId,
      description,
    })
    .expect(201);
}

describe('bills (billKind on recurring)', () => {
  it('accepts and returns a billKind, and rejects an unknown one', async () => {
    const created = await as(user)
      .post('/api/v1/recurring')
      .send({
        name: 'Electricity',
        type: 'expense',
        amountMinor: rupees(1_500),
        accountId: cash,
        frequency: 'monthly',
        dayOfMonth: 5,
        startDate: new Date().toISOString(),
        billKind: 'electricity',
      })
      .expect(201);
    expect(created.body.data.billKind).toBe('electricity');

    await as(user)
      .post('/api/v1/recurring')
      .send({
        name: 'Bogus',
        type: 'expense',
        amountMinor: rupees(100),
        accountId: cash,
        frequency: 'monthly',
        startDate: new Date().toISOString(),
        billKind: 'not-a-real-kind',
      })
      .expect(422);
  });
});

describe('subscription detector', () => {
  it('suggests a repeating payee + amount + monthly cadence, and stops once dismissed', async () => {
    const payee = (await as(user).post('/api/v1/payees').send({ name: 'Netflix' }).expect(201)).body.data.id;
    await postExpense(90, rupees(499), payee);
    await postExpense(60, rupees(499), payee);
    await postExpense(30, rupees(499), payee);

    const suggestions = await as(user).get('/api/v1/detector/subscriptions').expect(200);
    const netflix = suggestions.body.data.find((s: { payeeId?: string }) => s.payeeId === payee);
    expect(netflix).toBeDefined();
    expect(netflix.frequency).toBe('monthly');
    expect(netflix.occurrenceCount).toBe(3);

    await as(user).post('/api/v1/detector/subscriptions/dismiss').send({ signature: netflix.signature }).expect(200);

    const after = await as(user).get('/api/v1/detector/subscriptions').expect(200);
    expect(after.body.data.find((s: { signature: string }) => s.signature === netflix.signature)).toBeUndefined();
  });

  it('never suggests a pattern with a varying amount', async () => {
    const payee = (await as(user).post('/api/v1/payees').send({ name: 'Groceries' }).expect(201)).body.data.id;
    await postExpense(90, rupees(400), payee, 'Groceries');
    await postExpense(60, rupees(900), payee, 'Groceries');
    await postExpense(30, rupees(250), payee, 'Groceries');

    const suggestions = await as(user).get('/api/v1/detector/subscriptions').expect(200);
    expect(suggestions.body.data.find((s: { payeeId?: string }) => s.payeeId === payee)).toBeUndefined();
  });

  it('turns a suggestion into a paused-for-confirm bill, and never re-suggests it', async () => {
    const payee = (await as(user).post('/api/v1/payees').send({ name: 'Spotify' }).expect(201)).body.data.id;
    await postExpense(63, rupees(199), payee, 'Spotify');
    await postExpense(42, rupees(199), payee, 'Spotify');
    await postExpense(21, rupees(199), payee, 'Spotify');

    const suggestions = await as(user).get('/api/v1/detector/subscriptions').expect(200);
    const spotify = suggestions.body.data.find((s: { payeeId?: string }) => s.payeeId === payee);
    expect(spotify).toBeDefined();

    const bill = await as(user).post('/api/v1/detector/subscriptions/create-bill').send(spotify).expect(201);
    expect(bill.body.data.autoPost).toBe(false);
    expect(bill.body.data.billKind).toBe('subscription');
    expect(bill.body.data.payeeId).toBe(payee);

    const after = await as(user).get('/api/v1/detector/subscriptions').expect(200);
    expect(after.body.data.find((s: { signature: string }) => s.signature === spotify.signature)).toBeUndefined();
  });

  it('never leaks one user\'s detected patterns to another', async () => {
    const payee = (await as(user).post('/api/v1/payees').send({ name: 'Netflix' }).expect(201)).body.data.id;
    await postExpense(90, rupees(499), payee);
    await postExpense(60, rupees(499), payee);
    await postExpense(30, rupees(499), payee);

    const other = await createTestUser();
    const suggestions = await as(other).get('/api/v1/detector/subscriptions').expect(200);
    expect(suggestions.body.data).toEqual([]);
  });
});

describe('push subscriptions', () => {
  it('subscribes, upserts on the same endpoint, and unsubscribes', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123';
    await as(user)
      .post('/api/v1/push/subscribe')
      .send({ endpoint, keys: { p256dh: 'p256dh-value', auth: 'auth-value' } })
      .expect(200);
    // Re-subscribing the same endpoint (e.g. a rotated key) must not error or duplicate.
    await as(user)
      .post('/api/v1/push/subscribe')
      .send({ endpoint, keys: { p256dh: 'new-p256dh', auth: 'new-auth' } })
      .expect(200);

    await as(user).post('/api/v1/push/unsubscribe').send({ endpoint }).expect(200);
  });

  it('serves a null public key when VAPID is not configured (as in this test environment)', async () => {
    const res = await as(user).get('/api/v1/push/public-key').expect(200);
    expect(res.body.data.publicKey).toBeNull();
  });

  it('refuses an endpoint that is not a recognised browser push service (SSRF guard)', async () => {
    await as(user)
      .post('/api/v1/push/subscribe')
      .send({
        endpoint: 'https://169.254.169.254/latest/meta-data/iam/security-credentials/',
        keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
      })
      .expect(400);
  });
});
