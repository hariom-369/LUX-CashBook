import { beforeEach, describe, expect, it } from 'vitest';
import { Invitation } from '../src/models/index.js';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Report builder (§Phase 7): allow-listed filters and groupings -> table / chart / summary, saved,
 * duplicated and exported. Its definition is a closed schema; nothing from the request can choose a
 * field, an operator or an aggregation stage.
 */

let user: TestUser;
let wallet: string;
let bank: string;
let food: string;
let travel: string;
let salary: string;

const post = async (body: Record<string, unknown>) =>
  (await as(user).post('/api/v1/transactions').send({ date: new Date().toISOString(), ...body }).expect(201)).body.data.id as string;
const run = (definition: Record<string, unknown>) => as(user).post('/api/v1/reports/custom').send({ definition });

beforeEach(async () => {
  user = await createTestUser();
  wallet = (await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(100_000) }).expect(201)).body.data.id;
  bank = (await as(user).post('/api/v1/accounts').send({ name: 'HDFC', type: 'bank', openingBalanceMinor: rupees(100_000) }).expect(201)).body.data.id;
  const expenseCats = (await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data as Array<{ id: string; name: string }>;
  food = expenseCats[0]!.id;
  travel = expenseCats[1]!.id;
  salary = ((await as(user).get('/api/v1/categories?kind=income&flat=true').expect(200)).body.data as Array<{ id: string }>)[0]!.id;
  await post({ type: 'expense', amountMinor: rupees(500), accountId: wallet, categoryId: food, description: 'Lunch', tags: ['work'] });
  await post({ type: 'expense', amountMinor: rupees(300), accountId: bank, categoryId: food, description: 'Dinner', tags: ['work', 'team'] });
  await post({ type: 'expense', amountMinor: rupees(2_000), accountId: bank, categoryId: travel, description: 'Train', tags: [] });
  await post({ type: 'income', amountMinor: rupees(50_000), accountId: bank, categoryId: salary, description: 'Salary' });
  await post({ type: 'transfer', amountMinor: rupees(777), accountId: wallet, toAccountId: bank, description: 'Move' });
});

describe('running a report', () => {
  it('groups by category with income, expense, net and count - and leaves transfers out', async () => {
    const res = (await run({ groupBy: 'category' }).expect(200)).body.data;
    const byLabel = Object.fromEntries(res.rows.map((r: { label: string }) => [r.label, r]));
    const rows = res.rows as Array<{ expenseMinor: number; label: string }>;
    expect(rows.find((r) => r.expenseMinor === rupees(800))).toBeTruthy(); // food
    expect(rows.find((r) => r.expenseMinor === rupees(2_000))).toBeTruthy(); // travel
    expect(res.totals).toMatchObject({ incomeMinor: rupees(50_000), expenseMinor: rupees(2_800), netMinor: rupees(47_200), count: 4 });
    expect(Object.keys(byLabel).length).toBe(3);
    expect(res.overlapping).toBe(false);
  });

  it('groups by account, by month and by type', async () => {
    const accounts = (await run({ groupBy: 'account' }).expect(200)).body.data.rows as Array<{ label: string; expenseMinor: number; incomeMinor: number }>;
    expect(accounts.find((r) => r.label === 'HDFC')).toMatchObject({ expenseMinor: rupees(2_300), incomeMinor: rupees(50_000) });
    expect(accounts.find((r) => r.label === 'Wallet')).toMatchObject({ expenseMinor: rupees(500) });
    const months = (await run({ groupBy: 'month' }).expect(200)).body.data.rows as Array<{ key: string }>;
    expect(months).toHaveLength(1);
    expect(months[0]!.key).toMatch(/^\d{4}-\d{2}$/);
    const types = (await run({ groupBy: 'type' }).expect(200)).body.data.rows as Array<{ key: string }>;
    expect(types.map((r) => r.key).sort()).toEqual(['expense', 'income']);
  });

  it('groups by tag, lists a multi-tag entry under each, and says the rows overlap', async () => {
    const res = (await run({ groupBy: 'tag' }).expect(200)).body.data;
    expect(res.overlapping).toBe(true);
    const work = res.rows.find((r: { label: string }) => r.label === 'work');
    expect(work).toMatchObject({ expenseMinor: rupees(800), count: 2 });
    expect(res.rows.find((r: { label: string }) => r.label === 'team')).toMatchObject({ expenseMinor: rupees(300) });
    // The totals are the real ones, not the sum of the overlapping rows (800 + 300).
    expect(res.totals.expenseMinor).toBe(rupees(800 + 2_000));
  });

  it('filters by account, category, tag, type and amount range', async () => {
    expect((await run({ groupBy: 'category', accountIds: [wallet] }).expect(200)).body.data.totals.expenseMinor).toBe(rupees(500));
    expect((await run({ groupBy: 'category', categoryIds: [travel] }).expect(200)).body.data.totals.expenseMinor).toBe(rupees(2_000));
    expect((await run({ groupBy: 'category', tags: ['team'] }).expect(200)).body.data.totals.expenseMinor).toBe(rupees(300));
    expect((await run({ groupBy: 'category', types: ['income'] }).expect(200)).body.data.totals.incomeMinor).toBe(rupees(50_000));
    expect((await run({ groupBy: 'category', types: ['expense'], minAmountMinor: rupees(400) }).expect(200)).body.data.totals.expenseMinor).toBe(rupees(2_500));
  });

  it('respects the date range and soft-deleted entries', async () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const outside = (await run({ groupBy: 'category', from: future, to: new Date(Date.now() + 9 * 86_400_000).toISOString() }).expect(200)).body.data;
    expect(outside.rows).toEqual([]);

    const lunch = ((await as(user).get('/api/v1/transactions?search=Lunch').expect(200)).body.data.items as Array<{ id: string }>)[0]!.id;
    await as(user).delete(`/api/v1/transactions/${lunch}`).expect(200);
    expect((await run({ groupBy: 'category' }).expect(200)).body.data.totals.expenseMinor).toBe(rupees(2_300));
  });

  it('is workspace-scoped: another user sees nothing of this ledger', async () => {
    const other = await createTestUser();
    const res = (await as(other).post('/api/v1/reports/custom').send({ definition: { groupBy: 'category', accountIds: [wallet] } }).expect(200)).body.data;
    expect(res.rows).toEqual([]);
  });
});

describe('the definition is a closed allow-list', () => {
  it.each([
    ['an unknown field', { groupBy: 'category', $where: 'sleep(1000)' }],
    ['an unknown grouping', { groupBy: 'password' }],
    ['a field-path grouping', { groupBy: '$postings.amountMinor' }],
    ['a type outside income/expense', { groupBy: 'type', types: ['transfer'] }],
    ['an operator-shaped id', { groupBy: 'category', accountIds: [{ $ne: null }] }],
    ['a malformed id', { groupBy: 'category', categoryIds: ['not-an-id'] }],
    ['a negative amount', { groupBy: 'category', minAmountMinor: -5 }],
    ['an unknown range', { groupBy: 'category', range: 'forever' }],
  ])('rejects %s', async (_name, definition) => {
    const res = await run(definition as Record<string, unknown>);
    expect(res.status).toBe(400);
  });

  it('rejects a start date after the end date', async () => {
    const res = await run({ groupBy: 'category', from: new Date(Date.now() + 86_400_000).toISOString(), to: new Date().toISOString() });
    expect(res.status).toBe(400);
  });
});

describe('saving, duplicating, running and deleting', () => {
  const definition = { groupBy: 'category', range: 'last_3_months' };

  it('saves only a valid definition', async () => {
    expect((await as(user).post('/api/v1/saved-reports').send({ name: 'Bad', definition: { groupBy: 'nope' } })).status).toBe(400);
    const saved = (await as(user).post('/api/v1/saved-reports').send({ name: ' Spending by category ', definition }).expect(201)).body.data;
    expect(saved.name).toBe('Spending by category');
    expect(saved.definition.groupBy).toBe('category');
    expect(((await as(user).get('/api/v1/saved-reports').expect(200)).body.data as unknown[]).length).toBe(1);
  });

  it('runs fresh against the ledger every time, not against stored results', async () => {
    const saved = (await as(user).post('/api/v1/saved-reports').send({ name: 'R', definition: { groupBy: 'category' } }).expect(201)).body.data;
    const first = (await as(user).get(`/api/v1/saved-reports/${saved.id}/run`).expect(200)).body.data.totals.expenseMinor;
    await post({ type: 'expense', amountMinor: rupees(100), accountId: wallet, categoryId: food, description: 'Extra' });
    const second = (await as(user).get(`/api/v1/saved-reports/${saved.id}/run`).expect(200)).body.data.totals.expenseMinor;
    expect(second).toBe(first + rupees(100));
  });

  it('duplicates, renames, updates and deletes', async () => {
    const saved = (await as(user).post('/api/v1/saved-reports').send({ name: 'Original', definition }).expect(201)).body.data;
    const copy = (await as(user).post(`/api/v1/saved-reports/${saved.id}/duplicate`).expect(201)).body.data;
    expect(copy.name).toBe('Original (copy)');
    expect(copy.id).not.toBe(saved.id);
    const renamed = (await as(user).patch(`/api/v1/saved-reports/${copy.id}`).send({ name: 'By account', definition: { groupBy: 'account' } }).expect(200)).body.data;
    expect(renamed).toMatchObject({ name: 'By account', definition: { groupBy: 'account' } });
    await as(user).patch(`/api/v1/saved-reports/${copy.id}`).send({ definition: { groupBy: 'bogus' } }).expect(400);
    await as(user).delete(`/api/v1/saved-reports/${copy.id}`).expect(204);
    expect(((await as(user).get('/api/v1/saved-reports').expect(200)).body.data as unknown[]).length).toBe(1);
  });

  it("another workspace cannot see, run, change or delete someone else's saved report", async () => {
    const saved = (await as(user).post('/api/v1/saved-reports').send({ name: 'Mine', definition }).expect(201)).body.data;
    const other = await createTestUser();
    expect(((await as(other).get('/api/v1/saved-reports').expect(200)).body.data as unknown[]).length).toBe(0);
    await as(other).get(`/api/v1/saved-reports/${saved.id}/run`).expect(404);
    await as(other).patch(`/api/v1/saved-reports/${saved.id}`).send({ name: 'x' }).expect(404);
    await as(other).post(`/api/v1/saved-reports/${saved.id}/duplicate`).expect(404);
    await as(other).delete(`/api/v1/saved-reports/${saved.id}`).expect(404);
  });
});

describe('exporting', () => {
  it('returns CSV with exact figures', async () => {
    const res = await as(user).post('/api/v1/reports/custom/export').send({ definition: { groupBy: 'category' } }).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text.split('\n')[0]).toBe('category,Income,Expense,Net,Entries');
    expect(res.text).toContain('800.00');
    expect(res.text).toContain('2000.00');
  });

  it('neutralises a name that would run as a spreadsheet formula', async () => {
    const evil = await as(user).post('/api/v1/payees').send({ name: '=HYPERLINK("http://evil")' }).expect(201);
    await post({ type: 'expense', amountMinor: rupees(10), accountId: wallet, categoryId: food, payeeId: evil.body.data.id });
    const res = await as(user).post('/api/v1/reports/custom/export').send({ definition: { groupBy: 'payee' } }).expect(200);
    expect(res.text).not.toMatch(/^=HYPERLINK/m);
    expect(res.text).toContain("'=HYPERLINK");
  });
});

describe("private accounts", () => {
  it("another member's report never includes a private account's money", async () => {
    const member = await createTestUser();
    await as(user).post('/api/v1/workspace-invitations').send({ email: member.email, role: 'member' }).expect(201);
    const invitation = await Invitation.findOne({ workspaceId: user.workspaceId, email: member.email }).select('+tokenHash');
    const { generateActionToken, hashToken } = await import('../src/lib/tokens.js');
    const { token } = generateActionToken();
    invitation!.tokenHash = hashToken(token);
    await invitation!.save();
    await as(member).post(`/api/v1/invitations/${token}/accept`).expect(200);

    const secret = (await as(user).post('/api/v1/accounts').send({ name: 'Zebra Vault', type: 'savings', openingBalanceMinor: rupees(999_999), visibility: 'private' }).expect(201)).body.data.id;
    await post({ type: 'expense', amountMinor: rupees(123_456), accountId: secret, categoryId: food, description: 'Zebra spend', tags: ['zebra'] });

    for (const groupBy of ['category', 'account', 'tag', 'month', 'type']) {
      const mine = await as(member).post('/api/v1/reports/custom').set('X-Workspace-Id', user.workspaceId).send({ definition: { groupBy } }).expect(200);
      const text = JSON.stringify(mine.body);
      expect(text).not.toContain('Zebra');
      expect(text).not.toContain('12345600');
      expect(mine.body.data.totals.expenseMinor).toBe(rupees(2_800));
    }
    const owner = (await as(user).post('/api/v1/reports/custom').send({ definition: { groupBy: 'type' } }).expect(200)).body.data;
    expect(owner.totals.expenseMinor).toBe(rupees(2_800 + 123_456));
    // Asking for the private account explicitly yields nothing, not an error that confirms it exists.
    const probe = (await as(member).post('/api/v1/reports/custom').set('X-Workspace-Id', user.workspaceId).send({ definition: { groupBy: 'account', accountIds: [secret] } }).expect(200)).body.data;
    expect(probe.rows).toEqual([]);
  });
});
