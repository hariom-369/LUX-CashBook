import { describe, expect, it } from 'vitest';
import { anon, as, createTestUser } from './helpers.js';

/**
 * Phase 1 hardening (docs/PRODUCT_AUDIT.md, findings S-1…S-4).
 */

describe('API response caching (S-1)', () => {
  it('marks authenticated API responses no-store so the browser cache never keeps them', async () => {
    const user = await createTestUser();
    const response = await as(user).get('/api/v1/accounts').expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('applies to error responses too', async () => {
    const response = await anon().get('/api/v1/accounts').expect(401);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('CSV formula injection (S-4)', () => {
  it('escapes cells that a spreadsheet would run as a formula, and nothing else', async () => {
    const { csvText, csvTextIn } = await import('../src/lib/csv.js');
    for (const risky of ['=SUM(A1)', '+1+1', '-2+3', '@cmd', '\tx', '\rx']) {
      expect(csvText(risky)).toBe(`'${risky}`);
      expect(csvTextIn(csvText(risky))).toBe(risky);
    }
    for (const safe of ['Lunch', '', "O'Brien", '1250.00']) {
      expect(csvText(safe)).toBe(safe);
      expect(csvTextIn(safe)).toBe(safe);
    }
    expect(csvText(undefined)).toBe('');
  });

  it('escapes a formula-like description in the transaction export but leaves amounts numeric', async () => {
    const user = await createTestUser();
    const cash = (await as(user).post('/api/v1/accounts').send({ name: 'Drawer', type: 'cash', openingBalanceMinor: 100_000 }).expect(201)).body.data.id;
    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: 25_000, date: new Date().toISOString(), accountId: cash, description: '=HYPERLINK("https://evil.example","Refund")' })
      .expect(201);

    const csv = (await as(user).get('/api/v1/import-export/transactions.csv').expect(200)).text;
    expect(csv).toContain(`'=HYPERLINK`);
    expect(csv).not.toMatch(/,=HYPERLINK/);
    expect(csv).toContain(',250.00,');
  });

  it('keeps a negative balance numeric in the person ledger export', async () => {
    const user = await createTestUser();
    const cash = (await as(user).post('/api/v1/accounts').send({ name: 'Drawer', type: 'cash', openingBalanceMinor: 0 }).expect(201)).body.data.id;
    const person = (await as(user).post('/api/v1/people').send({ name: 'Priya' }).expect(201)).body.data.id;
    await as(user).post(`/api/v1/people/${person}/borrow`).send({ amountMinor: 50_000, accountId: cash }).expect(201);

    const csv = (await as(user).get(`/api/v1/import-export/people/${person}.csv`).expect(200)).text;
    expect(csv).toContain('-500.00');
    expect(csv).not.toContain(`'-500.00`);
  });

  it('round-trips: re-importing an export restores the original description', async () => {
    const user = await createTestUser();
    const cash = (await as(user).post('/api/v1/accounts').send({ name: 'Drawer', type: 'cash', openingBalanceMinor: 100_000 }).expect(201)).body.data.id;
    const description = '=1+1 is not a formula here';
    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: 1_000, date: new Date().toISOString(), accountId: cash, description })
      .expect(201);

    const csv = (await as(user).get('/api/v1/import-export/transactions.csv').expect(200)).text;
    const commit = await as(user)
      .post('/api/v1/import-export/commit')
      .attach('file', Buffer.from(csv), { filename: 'export.csv', contentType: 'text/csv' })
      .expect(200);
    expect(commit.body.data.imported).toBe(1);

    const list = (await as(user).get('/api/v1/transactions').expect(200)).body.data.items as Array<{ description: string }>;
    expect(list.map((t) => t.description)).toEqual([description, description]);
  });
});

describe('app-lock PIN (S-3)', () => {
  async function withPin(pin: string) {
    const user = await createTestUser();
    await as(user).post('/api/v1/auth/pin').send({ pin, password: user.password }).expect(200);
    return user;
  }
  const verify = (user: Awaited<ReturnType<typeof createTestUser>>, pin: string) =>
    as(user).post('/api/v1/auth/pin/verify').send({ pin });

  it('records the PIN length so the lock screen knows when entry is complete', async () => {
    const user = await withPin('482913');
    const me = await as(user).get('/api/v1/users/me').expect(200);
    expect(me.body.data.preferences.security.pinLength).toBe(6);
    await verify(user, '482913').expect(200);
  });

  it('locks PIN unlock after 5 wrong attempts — even the right PIN is refused', async () => {
    const user = await withPin('4829');
    for (let i = 0; i < 4; i++) await verify(user, '0000').expect(401);
    const fifth = await verify(user, '0000').expect(429);
    expect(fifth.body.error.message).toMatch(/Too many wrong PINs/);

    const correct = await verify(user, '4829').expect(429);
    expect(correct.body.error.message).toMatch(/sign in with your password/);
  });

  it('resets the count after a correct PIN', async () => {
    const user = await withPin('4829');
    for (let i = 0; i < 4; i++) await verify(user, '0000').expect(401);
    await verify(user, '4829').expect(200);
    for (let i = 0; i < 4; i++) await verify(user, '0000').expect(401);
    await verify(user, '4829').expect(200);
  });

  it('unlocks again once the lockout period has passed', async () => {
    const user = await withPin('4829');
    for (let i = 0; i < 5; i++) await verify(user, '0000');
    const { User } = await import('../src/models/index.js');
    await User.updateOne({ _id: user.userId }, { $set: { pinLockedUntil: new Date(Date.now() - 1000) } });
    await verify(user, '4829').expect(200);
  });

  it('clears the length and any lockout when the PIN is removed', async () => {
    const user = await withPin('4829');
    for (let i = 0; i < 5; i++) await verify(user, '0000');
    await as(user).delete('/api/v1/auth/pin').send({ password: user.password }).expect(200);
    const me = await as(user).get('/api/v1/users/me').expect(200);
    expect(me.body.data.preferences.security.pinLength).toBeNull();

    await as(user).post('/api/v1/auth/pin').send({ pin: '5930', password: user.password }).expect(200);
    await verify(user, '5930').expect(200);
  });
});

describe('feature flags', () => {
  it('serves every flag, all off by default, without requiring sign-in', async () => {
    const { FEATURE_FLAG_NAMES } = await import('@khata/shared');
    const response = await anon().get('/api/v1/features').expect(200);
    expect(Object.keys(response.body.data).sort()).toEqual([...FEATURE_FLAG_NAMES].sort());
    expect(Object.values(response.body.data).every((on) => on === false)).toBe(true);
  });

  it("layers a signed-in caller's workspace overrides on top of the env defaults", async () => {
    const user = await createTestUser();
    const { Workspace } = await import('../src/models/index.js');
    await Workspace.updateOne(
      { _id: user.workspaceId },
      { $set: { featureOverrides: { aiAssistant: true } } },
    );

    const response = await as(user).get('/api/v1/features').expect(200);
    expect(response.body.data.aiAssistant).toBe(true);
    expect(response.body.data.invoicing).toBe(false);
  });

  it("never applies one workspace's overrides to another", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    const { Workspace } = await import('../src/models/index.js');
    await Workspace.updateOne(
      { _id: owner.workspaceId },
      { $set: { featureOverrides: { invoicing: true } } },
    );

    expect((await as(other).get('/api/v1/features').expect(200)).body.data.invoicing).toBe(false);
    expect((await as(owner).get('/api/v1/features').expect(200)).body.data.invoicing).toBe(true);
  });

  it('ignores an invalid Authorization header rather than failing the request', async () => {
    const response = await anon().get('/api/v1/features').set('Authorization', 'Bearer not-a-real-token').expect(200);
    expect(Object.values(response.body.data).every((on) => on === false)).toBe(true);
  });

  it('rejects an override for an unknown flag name', async () => {
    const user = await createTestUser();
    const { Workspace } = await import('../src/models/index.js');
    await expect(
      Workspace.updateOne(
        { _id: user.workspaceId },
        { $set: { featureOverrides: { notARealFlag: true } } },
        { runValidators: true },
      ),
    ).rejects.toThrow(/Unknown feature flag|featureOverrides must map/);
  });
});

describe('deleting an account removes stored files too (S-6)', () => {
  it('deletes receipt files from storage, not just their records', async () => {
    const user = await createTestUser();
    const account = (await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: 10_000 }).expect(201)).body.data.id;
    const transaction = (
      await as(user)
        .post('/api/v1/transactions')
        .send({ type: 'expense', amountMinor: 500, date: new Date().toISOString(), accountId: account })
        .expect(201)
    ).body.data.id;

    const upload = await as(user)
      .post('/api/v1/attachments')
      .field('transactionId', transaction)
      .attach('file', Buffer.from('%PDF-1.4 receipt'), { filename: 'receipt.pdf', contentType: 'application/pdf' })
      .expect(201);

    const { Attachment } = await import('../src/models/index.js');
    const { getStorageDriver } = await import('../src/lib/storage.js');
    const stored = await Attachment.findById(upload.body.data.id).lean();
    expect(await getStorageDriver().exists(stored!.storageKey)).toBe(true);

    await as(user).post('/api/v1/users/me/delete').send({ password: user.password, confirmation: 'DELETE' }).expect(200);

    expect(await getStorageDriver().exists(stored!.storageKey)).toBe(false);
    expect(await Attachment.countDocuments({ _id: upload.body.data.id })).toBe(0);
  });
});

describe('security activity history', () => {
  it("lists the user's own account events, newest first, without secrets", async () => {
    const user = await createTestUser();
    await as(user).post('/api/v1/auth/pin').send({ pin: '4829', password: user.password }).expect(200);
    await as(user).delete('/api/v1/auth/pin').send({ password: user.password }).expect(200);

    const events = (await as(user).get('/api/v1/users/me/security-activity').expect(200)).body.data as Array<{
      summary: string;
    }>;
    expect(events.map((e) => e.summary).slice(0, 2)).toEqual(['App-lock PIN removed', 'App-lock PIN set']);
    expect(JSON.stringify(events)).not.toContain('4829');
    expect(JSON.stringify(events)).not.toContain(user.password);
  });

  it("never shows another user's events", async () => {
    const user = await createTestUser();
    const other = await createTestUser();
    await as(other).post('/api/v1/auth/pin').send({ pin: '5930', password: other.password }).expect(200);

    const events = (await as(user).get('/api/v1/users/me/security-activity').expect(200)).body.data as Array<{
      summary: string;
    }>;
    expect(events.some((e) => e.summary.includes('PIN'))).toBe(false);
  });

  it('records a password change', async () => {
    const user = await createTestUser();
    await as(user)
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: user.password, newPassword: 'Another-Horse-7!' })
      .expect(200);
    const { AuditLog } = await import('../src/models/index.js');
    expect(await AuditLog.countDocuments({ userId: user.userId, action: 'password_changed' })).toBe(1);
  });
});

describe('optimistic concurrency (stale-edit detection)', () => {
  it('refuses a second edit made against a stale revision, with 409', async () => {
    const user = await createTestUser();
    const created = await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: 1000 }).expect(201);
    const rev = created.body.data.rev;
    expect(typeof rev).toBe('number');

    await as(user).patch(`/api/v1/accounts/${created.body.data.id}`).send({ name: 'Wallet A', rev }).expect(200);

    const stale = await as(user).patch(`/api/v1/accounts/${created.body.data.id}`).send({ name: 'Wallet B', rev }).expect(409);
    expect(stale.body.error.code).toBe('STALE_REVISION');

    const current = await as(user).get(`/api/v1/accounts/${created.body.data.id}`).expect(200);
    expect(current.body.data.name).toBe('Wallet A');
  });

  it('bumps the revision on every accepted edit, across accounts, people, budgets, goals, recurring and transactions', async () => {
    const user = await createTestUser();
    const cash = (await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: 100_000 }).expect(201)).body.data.id;
    const expenseCategory = (await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id;

    const cases: Array<[string, object, object]> = [
      ['accounts', { name: 'Savings', type: 'bank', openingBalanceMinor: 0 }, { name: 'Renamed' }],
      ['people', { name: 'Rahul' }, { name: 'Rahul K' }],
      ['budgets', { name: 'Food', categoryId: expenseCategory, amountMinor: 1000, period: 'monthly' }, { amountMinor: 2000 }],
      ['goals', { name: 'Trip', targetMinor: 50_000 }, { name: 'Trip 2' }],
      ['recurring', { name: 'Rent', type: 'expense', amountMinor: 5000, accountId: cash, categoryId: expenseCategory, frequency: 'monthly', startDate: new Date().toISOString() }, { amountMinor: 6000 }],
      ['transactions', { type: 'expense', amountMinor: 500, date: new Date().toISOString(), accountId: cash, categoryId: expenseCategory }, { amountMinor: 700 }],
    ];

    for (const [resource, body, patch] of cases) {
      const created = await as(user).post(`/api/v1/${resource}`).send(body).expect(201);
      const id = created.body.data.id;
      const rev = created.body.data.rev;
      expect(rev, resource).toBe(0);

      const updated = await as(user)
        .patch(`/api/v1/${resource}/${id}`)
        .send({ ...patch, rev })
        .expect(200);
      expect(updated.body.data.rev, resource).toBe(1);

      await as(user).patch(`/api/v1/${resource}/${id}`).send({ rev }).expect(409);
    }
  });

  it('lets an older client omit rev and keep last-write-wins', async () => {
    const user = await createTestUser();
    const created = await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: 0 }).expect(201);
    await as(user).patch(`/api/v1/accounts/${created.body.data.id}`).send({ name: 'No rev sent' }).expect(200);
    const after = await as(user).get(`/api/v1/accounts/${created.body.data.id}`).expect(200);
    expect(after.body.data.name).toBe('No rev sent');
  });

  it('two concurrent edits: exactly one succeeds, the other is refused as stale', async () => {
    const user = await createTestUser();
    const created = await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: 0 }).expect(201);
    const rev = created.body.data.rev;

    const [a, b] = await Promise.all([
      as(user).patch(`/api/v1/accounts/${created.body.data.id}`).send({ name: 'A', rev }),
      as(user).patch(`/api/v1/accounts/${created.body.data.id}`).send({ name: 'B', rev }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});
