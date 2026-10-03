import { beforeEach, describe, expect, it } from 'vitest';
import { as, createTestUser, type TestUser } from './helpers.js';

let user: TestUser;
beforeEach(async () => {
  user = await createTestUser();
});

describe('demo workspace (§Phase 16)', () => {
  it('creates a flagged sample workspace with real data and a clean ledger', async () => {
    const demo = await as(user).post('/api/v1/workspaces/demo').expect(201);
    expect(demo.body.data.isDemo).toBe(true);
    const h = { 'X-Workspace-Id': demo.body.data.id };

    const txns = await as(user).get('/api/v1/transactions').set(h).expect(200);
    expect(txns.body.data.items.length).toBeGreaterThanOrEqual(8);
    const people = await as(user).get('/api/v1/people').set(h).expect(200);
    expect(people.body.data[0].balanceMinor).toBe(150_000);

    const integrity = await as(user).get('/api/v1/integrity').set(h).expect(200);
    expect(integrity.body.data.issues).toEqual([]);
    expect(integrity.body.data.ok).toBe(true);
  });

  it('refuses a second demo workspace and can be removed without typing its name', async () => {
    const demo = await as(user).post('/api/v1/workspaces/demo').expect(201);
    await as(user).post('/api/v1/workspaces/demo').expect(409);
    await as(user).delete(`/api/v1/workspaces/${demo.body.data.id}`).send({ confirmation: 'anything' }).expect(200);
  });
});
