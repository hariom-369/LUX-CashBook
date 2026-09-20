import { beforeEach, describe, expect, it } from 'vitest';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

let user: TestUser;
let cash: string;
let bank: string;
let expenseCategory: string;
let incomeCategory: string;

beforeEach(async () => {
  user = await createTestUser();

  const cashRes = await as(user).post('/api/v1/accounts').send({ name: 'Drawer', type: 'cash', openingBalanceMinor: rupees(5_000) }).expect(201);
  cash = cashRes.body.data.id;
  const bankRes = await as(user).post('/api/v1/accounts').send({ name: 'Bank', type: 'bank', openingBalanceMinor: rupees(50_000) }).expect(201);
  bank = bankRes.body.data.id;

  expenseCategory = (await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id;
  incomeCategory = (await as(user).get('/api/v1/categories?kind=income&flat=true').expect(200)).body.data[0].id;
});

describe('CSV export and import', () => {
  it('exports transactions as CSV with a header row', async () => {
    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(500), date: new Date().toISOString(), accountId: cash, categoryId: expenseCategory, description: 'Snacks' })
      .expect(201);

    const response = await as(user).get('/api/v1/import-export/transactions.csv').expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain('Date,Type,Amount');
    expect(response.text).toContain('Snacks');
    expect(response.text).toContain('500.00');
  });

  it('previews an import without writing anything, flagging bad rows', async () => {
    const csv = [
      'Date,Type,Amount,Account,Category,Description',
      `2026-09-01,expense,250.00,Drawer,,Valid row`,
      `2026-09-02,expense,abc,Drawer,,Bad amount`,
      `2026-09-03,expense,100.00,Nonexistent Account,,Bad account`,
    ].join('\n');

    const response = await as(user)
      .post('/api/v1/import-export/preview')
      .attach('file', Buffer.from(csv), { filename: 'import.csv', contentType: 'text/csv' })
      .expect(200);

    expect(response.body.data.validCount).toBe(1);
    expect(response.body.data.errorCount).toBe(2);

    // Nothing was actually imported by the preview.
    const list = await as(user).get('/api/v1/transactions').expect(200);
    expect(list.body.data.total).toBe(0);
  });

  it('imports valid rows, skips invalid ones, and supports undo as a batch', async () => {
    const csv = [
      'Date,Type,Amount,Account,Category,Description',
      `2026-09-01,expense,250.00,Drawer,,Row one`,
      `2026-09-02,expense,300.00,Drawer,,Row two`,
      `2026-09-03,expense,bad,Drawer,,Row three (bad)`,
    ].join('\n');

    const commit = await as(user)
      .post('/api/v1/import-export/commit')
      .attach('file', Buffer.from(csv), { filename: 'import.csv', contentType: 'text/csv' })
      .expect(200);

    expect(commit.body.data.imported).toBe(2);
    expect(commit.body.data.skipped).toBe(1);

    let list = await as(user).get('/api/v1/transactions').expect(200);
    expect(list.body.data.total).toBe(2);

    const account = await as(user).get(`/api/v1/accounts/${cash}`).expect(200);
    expect(account.body.data.balanceMinor).toBe(rupees(5_000 - 250 - 300));

    // Undo removes exactly the imported rows and restores the balance.
    await as(user).post(`/api/v1/import-export/undo/${commit.body.data.importBatchId}`).expect(200);

    list = await as(user).get('/api/v1/transactions').expect(200);
    expect(list.body.data.total).toBe(0);

    const restored = await as(user).get(`/api/v1/accounts/${cash}`).expect(200);
    expect(restored.body.data.balanceMinor).toBe(rupees(5_000));
  });
});

describe('backup and restore', () => {
  it('round-trips a complete workspace into a new one with matching balances', async () => {
    const person = (await as(user).post('/api/v1/people').send({ name: 'Rahul' }).expect(201)).body.data.id;

    await as(user).post('/api/v1/transactions').send({ type: 'income', amountMinor: rupees(20_000), date: new Date().toISOString(), accountId: bank, categoryId: incomeCategory }).expect(201);
    await as(user).post('/api/v1/transactions').send({ type: 'expense', amountMinor: rupees(1_500), date: new Date().toISOString(), accountId: cash, categoryId: expenseCategory }).expect(201);
    await as(user).post('/api/v1/transactions').send({ type: 'transfer', amountMinor: rupees(2_000), date: new Date().toISOString(), accountId: bank, toAccountId: cash }).expect(201);
    await as(user).post(`/api/v1/people/${person}/lend`).send({ amountMinor: rupees(1_000), accountId: cash }).expect(201);

    const backupResponse = await as(user).get('/api/v1/backup').expect(200);
    const backup = JSON.parse(backupResponse.text);
    expect(backup.backupVersion).toBe(1);
    expect(backup.transactions.length).toBe(4);
    expect(backup.accounts.length).toBeGreaterThanOrEqual(2);

    const restoreResponse = await as(user)
      .post('/api/v1/backup/restore')
      .field('workspaceName', 'Restored Copy')
      .attach('file', Buffer.from(JSON.stringify(backup)), { filename: 'backup.json', contentType: 'application/json' })
      .expect(201);

    expect(restoreResponse.body.data.counts.transactions).toBe(4);

    const restoredWorkspace = restoreResponse.body.data.workspaces.find((w: { name: string }) => w.name === 'Restored Copy');
    expect(restoredWorkspace).toBeDefined();

    // Every balance in the new workspace must match the original — the whole
    // point of a backup is that restoring it changes nothing about the numbers.
    const restoredAccounts = await as(user).get('/api/v1/accounts').set('X-Workspace-Id', restoredWorkspace.id).expect(200);
    const restoredCash = restoredAccounts.body.data.find((a: { name: string }) => a.name === 'Drawer');
    const restoredBank = restoredAccounts.body.data.find((a: { name: string }) => a.name === 'Bank');

    // cash: 5,000 - 1,500 (expense) + 2,000 (transfer in) - 1,000 (lent) = 4,500
    expect(restoredCash.balanceMinor).toBe(rupees(5_000 - 1_500 + 2_000 - 1_000));
    // bank: 50,000 + 20,000 (income) - 2,000 (transfer out) = 68,000
    expect(restoredBank.balanceMinor).toBe(rupees(50_000 + 20_000 - 2_000));

    const restoredIntegrity = await as(user).get('/api/v1/integrity').set('X-Workspace-Id', restoredWorkspace.id).expect(200);
    expect(restoredIntegrity.body.data.ok).toBe(true);
  });

  it('refuses to restore a file that is not a recognised backup', async () => {
    await as(user)
      .post('/api/v1/backup/restore')
      .attach('file', Buffer.from(JSON.stringify({ hello: 'world' })), { filename: 'backup.json', contentType: 'application/json' })
      .expect(400);
  });
});

describe('petty cash', () => {
  it('is only available in a business workspace', async () => {
    await as(user).get('/api/v1/petty-cash').expect(403);
  });

  it('tracks the float and replenishes exactly the amount spent', async () => {
    const business = await as(user).post('/api/v1/workspaces').send({ name: 'Shop', mode: 'business', currency: 'INR' }).expect(201);
    const bizHeaders = { 'X-Workspace-Id': business.body.data.id };

    const drawer = await as(user).post('/api/v1/accounts').set(bizHeaders).send({ name: 'Petty Drawer', type: 'cash', openingBalanceMinor: rupees(5_000) }).expect(201);
    const mainBank = await as(user).post('/api/v1/accounts').set(bizHeaders).send({ name: 'Main Bank', type: 'bank', openingBalanceMinor: rupees(100_000) }).expect(201);

    const pettyCash = await as(user)
      .post('/api/v1/petty-cash')
      .set(bizHeaders)
      .send({ accountId: drawer.body.data.id, imprestMinor: rupees(5_000), replenishFromAccountId: mainBank.body.data.id })
      .expect(201);

    const expenseCat = (await as(user).get('/api/v1/categories?kind=expense&flat=true').set(bizHeaders).expect(200)).body.data[0].id;

    await as(user).post('/api/v1/transactions').set(bizHeaders).send({ type: 'expense', amountMinor: rupees(1_850), date: new Date().toISOString(), accountId: drawer.body.data.id, categoryId: expenseCat }).expect(201);

    let list = await as(user).get('/api/v1/petty-cash').set(bizHeaders).expect(200);
    expect(list.body.data[0].spentSinceReplenishMinor).toBe(rupees(1_850));
    expect(list.body.data[0].currentMinor).toBe(rupees(3_150));

    const replenish = await as(user).post(`/api/v1/petty-cash/${pettyCash.body.data.id}/replenish`).set(bizHeaders).expect(200);
    expect(replenish.body.data.replenishedMinor).toBe(rupees(1_850));

    const drawerAfter = await as(user).get(`/api/v1/accounts/${drawer.body.data.id}`).set(bizHeaders).expect(200);
    expect(drawerAfter.body.data.balanceMinor).toBe(rupees(5_000)); // back to the full float

    const bankAfter = await as(user).get(`/api/v1/accounts/${mainBank.body.data.id}`).set(bizHeaders).expect(200);
    expect(bankAfter.body.data.balanceMinor).toBe(rupees(100_000 - 1_850));
  });
});

describe('daily and month closing', () => {
  it('computes the expected closing figure and records the difference', async () => {
    const business = await as(user).post('/api/v1/workspaces').send({ name: 'Store', mode: 'business', currency: 'INR' }).expect(201);
    const bizHeaders = { 'X-Workspace-Id': business.body.data.id };

    const drawer = await as(user).post('/api/v1/accounts').set(bizHeaders).send({ name: 'Store Cash', type: 'cash', openingBalanceMinor: rupees(25_000) }).expect(201);
    const expenseCat = (await as(user).get('/api/v1/categories?kind=expense&flat=true').set(bizHeaders).expect(200)).body.data[0].id;
    const incomeCat = (await as(user).get('/api/v1/categories?kind=income&flat=true').set(bizHeaders).expect(200)).body.data[0].id;

    const today = new Date().toISOString();
    await as(user).post('/api/v1/transactions').set(bizHeaders).send({ type: 'income', amountMinor: rupees(3_000), date: today, accountId: drawer.body.data.id, categoryId: incomeCat }).expect(201);
    await as(user).post('/api/v1/transactions').set(bizHeaders).send({ type: 'expense', amountMinor: rupees(500), date: today, accountId: drawer.body.data.id, categoryId: expenseCat }).expect(201);

    const preview = await as(user).get(`/api/v1/closing/day/preview?date=${today}&accountIds=${drawer.body.data.id}`).set(bizHeaders).expect(200);
    expect(preview.body.data.expectedClosingMinor).toBe(rupees(25_000 + 3_000 - 500)); // 27,500

    const closing = await as(user)
      .post('/api/v1/closing/day')
      .set(bizHeaders)
      .send({ date: today, actualClosingMinor: rupees(27_300), accountIds: [drawer.body.data.id] })
      .expect(201);

    expect(closing.body.data.expectedClosingMinor).toBe(rupees(27_500));
    expect(closing.body.data.differenceMinor).toBe(-rupees(200));

    // Closing the same day twice is refused.
    await as(user)
      .post('/api/v1/closing/day')
      .set(bizHeaders)
      .send({ date: today, actualClosingMinor: rupees(27_300), accountIds: [drawer.body.data.id] })
      .expect(409);
  });

  it('blocks new transactions in a closed month and allows reopening', async () => {
    // Month closing is a business-mode feature (§55).
    const business = await as(user).post('/api/v1/workspaces').send({ name: 'Ledger Co', mode: 'business', currency: 'INR' }).expect(201);
    const bizHeaders = { 'X-Workspace-Id': business.body.data.id };

    const now = new Date();
    const bank2 = (await as(user).post('/api/v1/accounts').set(bizHeaders).send({ name: 'Ops Bank', type: 'bank', openingBalanceMinor: rupees(10_000) }).expect(201)).body.data.id;
    const bizExpenseCat = (await as(user).get('/api/v1/categories?kind=expense&flat=true').set(bizHeaders).expect(200)).body.data[0].id;

    const closing = await as(user).post('/api/v1/closing/month').set(bizHeaders).send({ year: now.getFullYear(), month: now.getMonth() + 1 }).expect(201);

    const blocked = await as(user)
      .post('/api/v1/transactions')
      .set(bizHeaders)
      .send({ type: 'expense', amountMinor: rupees(100), date: now.toISOString(), accountId: bank2, categoryId: bizExpenseCat })
      .expect(409);
    expect(blocked.body.error.code).toBe('PERIOD_CLOSED');

    await as(user).post(`/api/v1/closing/month/${closing.body.data.id}/reopen`).set(bizHeaders).expect(200);

    await as(user)
      .post('/api/v1/transactions')
      .set(bizHeaders)
      .send({ type: 'expense', amountMinor: rupees(100), date: now.toISOString(), accountId: bank2, categoryId: bizExpenseCat })
      .expect(201);
  });
});

describe('audit trail', () => {
  it('records a summary for created, updated and deleted actions', async () => {
    const created = await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(300), date: new Date().toISOString(), accountId: cash, categoryId: expenseCategory })
      .expect(201);

    await as(user).patch(`/api/v1/transactions/${created.body.data.id}`).send({ amountMinor: rupees(350) }).expect(200);
    await as(user).delete(`/api/v1/transactions/${created.body.data.id}`).expect(200);

    const log = await as(user).get('/api/v1/audit-log?entityType=Transaction').expect(200);
    const actions = log.body.data.items.map((entry: { action: string }) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(['created', 'updated', 'deleted']));
  });
});
