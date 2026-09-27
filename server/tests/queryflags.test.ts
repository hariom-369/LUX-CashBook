import { beforeEach, describe, expect, it } from 'vitest';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Regression: boolean query flags were parsed with `z.coerce.boolean()`, so the
 * literal `?flag=false` the client sends meant `true` — the Notifications page
 * hid read notifications, account pickers listed deactivated accounts, and
 * "not done" reminder lists included finished ones.
 */

let user: TestUser;
let cash: string;

beforeEach(async () => {
  user = await createTestUser();
  cash = (await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(1_000) }).expect(201)).body.data.id;
});

describe('boolean query flags', () => {
  it('?includeInactive=false leaves deactivated accounts out; =true brings them in', async () => {
    const old = (await as(user).post('/api/v1/accounts').send({ name: 'Old bank', type: 'bank' }).expect(201)).body.data.id;
    await as(user).patch(`/api/v1/accounts/${old}`).send({ isActive: false }).expect(200);

    const active = (await as(user).get('/api/v1/accounts?includeInactive=false').expect(200)).body.data as Array<{ id: string }>;
    expect(active.map((a) => a.id)).not.toContain(old);

    const all = (await as(user).get('/api/v1/accounts?includeInactive=true').expect(200)).body.data as Array<{ id: string }>;
    expect(all.map((a) => a.id)).toContain(old);
  });

  it('?includeDone=false leaves completed reminders out', async () => {
    const reminder = (
      await as(user).post('/api/v1/reminders').send({ title: 'Rent', type: 'rent', dueDate: new Date().toISOString() }).expect(201)
    ).body.data.id;
    await as(user).post(`/api/v1/reminders/${reminder}/complete`).expect(200);

    expect((await as(user).get('/api/v1/reminders?includeDone=false').expect(200)).body.data).toHaveLength(0);
    expect((await as(user).get('/api/v1/reminders?includeDone=true').expect(200)).body.data).toHaveLength(1);
  });

  it('?hasAttachment=false does not filter to transactions with receipts', async () => {
    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(10), date: new Date().toISOString(), accountId: cash })
      .expect(201);

    expect((await as(user).get('/api/v1/transactions?hasAttachment=false').expect(200)).body.data.total).toBe(1);
    expect((await as(user).get('/api/v1/transactions?hasAttachment=true').expect(200)).body.data.total).toBe(0);
  });

  it('rejects a flag value that is not a boolean word', async () => {
    const response = await as(user).get('/api/v1/reminders?includeDone=maybe');
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});
