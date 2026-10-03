import { beforeEach, describe, expect, it } from 'vitest';
import { Account, IdempotencyRecord, Transaction } from '../src/models/index.js';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Exactly-once creates (§Phase 15 follow-up): a repeat of a write that carries the same
 * `Idempotency-Key` must never apply twice — including the case where the original
 * request reached the server and only the response was lost.
 */

let user: TestUser;
beforeEach(async () => {
  user = await createTestUser();
});

const createAccount = (key: string | undefined, body: Record<string, unknown> = { name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(100) }) => {
  const req = as(user).post('/api/v1/accounts');
  if (key) req.set('Idempotency-Key', key);
  return req.send(body);
};

describe('Idempotency-Key', () => {
  it('replays the original response for a repeat, creating nothing new', async () => {
    const first = await createAccount('key-aaaa-0001').expect(201);
    const repeat = await createAccount('key-aaaa-0001').expect(201);

    expect(repeat.headers['idempotent-replay']).toBe('true');
    expect(first.headers['idempotent-replay']).toBeUndefined();
    expect(repeat.body).toEqual(first.body);
    expect(await Account.countDocuments({ workspaceId: user.workspaceId, name: 'Wallet' })).toBe(1);
  });

  it('is the safe answer to "the server did it but I never heard back" for a money entry', async () => {
    const wallet = (await createAccount(undefined).expect(201)).body.data.id as string;
    const body = { type: 'expense', amountMinor: rupees(40), date: new Date().toISOString(), accountId: wallet, description: 'Chai' };
    const send = () => as(user).post('/api/v1/transactions').set('Idempotency-Key', 'tx-retry-0001').send(body);

    const first = await send().expect(201);
    const retry = await send().expect(201); // the client lost the first reply and re-sent
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(await Transaction.countDocuments({ workspaceId: user.workspaceId, description: 'Chai' })).toBe(1);
    const balance = (await as(user).get(`/api/v1/accounts/${wallet}`).expect(200)).body.data.balanceMinor;
    expect(balance).toBe(rupees(100) - rupees(40)); // debited once, not twice
  });

  it('applies exactly once when identical requests arrive at the same time', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => createAccount('key-race-0001').then((r) => r.status)),
    );
    expect(results.filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
    expect(results.every((s) => s === 201 || s === 409)).toBe(true);
    expect(await Account.countDocuments({ workspaceId: user.workspaceId, name: 'Wallet' })).toBe(1);
  });

  it('refuses the same key for a different request', async () => {
    await createAccount('key-diff-0001').expect(201);
    const reused = await createAccount('key-diff-0001', { name: 'Other', type: 'cash', openingBalanceMinor: 0 }).expect(422);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await Account.countDocuments({ workspaceId: user.workspaceId, name: 'Other' })).toBe(0);
  });

  it('scopes keys per user — another user may use the same key freely', async () => {
    await createAccount('key-user-0001').expect(201);
    const other = await createTestUser();
    const res = await as(other).post('/api/v1/accounts').set('Idempotency-Key', 'key-user-0001')
      .send({ name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(5) }).expect(201);
    expect(res.headers['idempotent-replay']).toBeUndefined();
    expect(await Account.countDocuments({ name: 'Wallet' })).toBe(2);
  });

  it('forgets a rejected request so the user can fix it and retry with the same key', async () => {
    const rejected = await createAccount('key-fail-0001', { name: '', type: 'cash' });
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect(await IdempotencyRecord.countDocuments({ key: 'key-fail-0001' })).toBe(0);
    const fixed = await createAccount('key-fail-0001').expect(201);
    expect(fixed.headers['idempotent-replay']).toBeUndefined();
  });

  it('does nothing without the header (existing behaviour is unchanged)', async () => {
    await createAccount(undefined).expect(201);
    expect(await IdempotencyRecord.countDocuments({})).toBe(0);
  });

  it('rejects a malformed key', async () => {
    const res = await createAccount('short').expect(400);
    expect(res.body.error.message).toMatch(/Idempotency-Key/);
  });

  it('ignores the header on an unauthenticated or forged-token request', async () => {
    const forged = await as(user).post('/api/v1/accounts').set('Authorization', 'Bearer not.a.token')
      .set('Idempotency-Key', 'key-forged-0001').send({ name: 'X', type: 'cash' });
    expect(forged.status).toBe(401);
    expect(await IdempotencyRecord.countDocuments({ key: 'key-forged-0001' })).toBe(0);
  });

  it('never stores a record for a failed authorization', async () => {
    const res = await as(user).post('/api/v1/accounts').set('X-Workspace-Id', '000000000000000000000000')
      .set('Idempotency-Key', 'key-scope-0001').send({ name: 'X', type: 'cash' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await IdempotencyRecord.countDocuments({ key: 'key-scope-0001' })).toBe(0);
  });
});
