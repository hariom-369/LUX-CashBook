import { beforeEach, describe, expect, it } from 'vitest';
import { Invitation } from '../src/models/index.js';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Private accounts (docs/ROADMAP_PHASE9_NOTES.md → "known, named gap"; roadmap Phase 9 tests:
 * "private-account leakage tests on lists, reports, search, exports and backups").
 *
 * The owner keeps a private account ("Zebra Vault") alongside a shared Cash account. A second
 * workspace *member* must never learn that it exists — not from its name, id, transactions or
 * attachments, and not from any total, balance, report row, ledger, export or notification
 * that its money would otherwise flow into. Every probe is a different code path that builds
 * its own `Transaction` / `Account` query.
 */

let owner: TestUser;
let member: TestUser;
let zebraId = '';
let cashId = '';
let pennyId = '';
let zebraTxnId = '';
let sharedTxnId = '';

// Distinctive figures (in minor units) that appear nowhere else.
const ZEBRA_OPENING = rupees(2_468_013);
const ZEBRA_INCOME = rupees(135_791);
const ZEBRA_EXPENSE = rupees(24_680);
const ZEBRA_LOAN = rupees(13_579);
const SECRET_NUMBERS = [ZEBRA_OPENING, ZEBRA_INCOME, ZEBRA_EXPENSE, ZEBRA_LOAN].map(String);
const SHARED_INCOME = rupees(50_000);
const SHARED_EXPENSE = rupees(1_111);
const SHARED_BALANCE = SHARED_INCOME - SHARED_EXPENSE;

const asMember = () => {
  const agent = as(member);
  const scoped = (req: ReturnType<typeof agent.get>) => req.set('X-Workspace-Id', owner.workspaceId);
  return {
    get: (p: string) => scoped(agent.get(p)),
    post: (p: string) => scoped(agent.post(p)),
    patch: (p: string) => scoped(agent.patch(p)),
    delete: (p: string) => scoped(agent.delete(p)),
  };
};

/** Fails with the offending endpoint and marker if a response mentions anything private. */
function assertNoLeak(label: string, payload: unknown) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const marker of ['Zebra', zebraId, ...SECRET_NUMBERS]) {
    expect(text.includes(marker), `${label} leaked "${marker}"`).toBe(false);
  }
}

beforeEach(async () => {
  owner = await createTestUser();
  member = await createTestUser();

  await as(owner).post('/api/v1/workspace-invitations').send({ email: member.email, role: 'member' }).expect(201);
  const invitation = await Invitation.findOne({ workspaceId: owner.workspaceId, email: member.email }).select('+tokenHash');
  const { generateActionToken, hashToken } = await import('../src/lib/tokens.js');
  const { token } = generateActionToken();
  invitation!.tokenHash = hashToken(token);
  await invitation!.save();
  await as(member).post(`/api/v1/invitations/${token}/accept`).expect(200);

  const accounts = (await as(owner).get('/api/v1/accounts').expect(200)).body.data as Array<{ id: string; name: string; type: string }>;
  cashId = accounts.find((a) => a.type === 'cash')!.id;
  zebraId = (
    await as(owner)
      .post('/api/v1/accounts')
      .send({ name: 'Zebra Vault', type: 'savings', openingBalanceMinor: ZEBRA_OPENING, visibility: 'private' })
      .expect(201)
  ).body.data.id;

  const expenseCat = (await as(owner).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id as string;
  const incomeCat = (await as(owner).get('/api/v1/categories?kind=income&flat=true').expect(200)).body.data[0].id as string;
  const now = new Date().toISOString();
  const tx = async (body: Record<string, unknown>) => (await as(owner).post('/api/v1/transactions').send({ date: now, ...body }).expect(201)).body.data.id as string;

  // Shared money everyone may see.
  await tx({ type: 'income', amountMinor: SHARED_INCOME, accountId: cashId, categoryId: incomeCat, description: 'Shared salary' });
  sharedTxnId = await tx({ type: 'expense', amountMinor: SHARED_EXPENSE, accountId: cashId, categoryId: expenseCat, description: 'Shared lunch' });

  // Private money only the owner may see.
  await tx({ type: 'income', amountMinor: ZEBRA_INCOME, accountId: zebraId, categoryId: incomeCat, description: 'Zebra bonus' });
  zebraTxnId = await tx({ type: 'expense', amountMinor: ZEBRA_EXPENSE, accountId: zebraId, categoryId: expenseCat, description: 'Zebra purchase', tags: ['zebra-tag'] });
  // A transfer between a shared and the private account touches both.
  await tx({ type: 'transfer', amountMinor: rupees(777), accountId: cashId, toAccountId: zebraId, description: 'Zebra top-up' });

  pennyId = (await as(owner).post('/api/v1/people').send({ name: 'Penny Lender', relationship: 'friend' }).expect(201)).body.data.id;
  // A loan paid out of the private account: Penny owes the household, but only the owner can see how it was funded.
  await as(owner).post(`/api/v1/people/${pennyId}/lend`).send({ amountMinor: ZEBRA_LOAN, accountId: zebraId, date: now, note: 'Zebra loan' }).expect(201);

  await as(owner).post('/api/v1/goals').send({ name: 'Zebra goal', targetMinor: rupees(900_000), linkedAccountId: zebraId }).expect(201);
  await as(owner).post('/api/v1/budgets').send({ name: 'Zebra budget', categoryId: expenseCat, accountId: zebraId, amountMinor: rupees(30_000) }).expect(201);
  await as(owner)
    .post('/api/v1/recurring')
    .send({ name: 'Zebra rent', type: 'expense', amountMinor: rupees(9_999), accountId: zebraId, categoryId: expenseCat, frequency: 'monthly', startDate: now, autoPost: false, billKind: 'rent' })
    .expect(201);
});

const range = () => `from=${encodeURIComponent(new Date(Date.now() - 400 * 86400000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}`;

describe('another member never learns a private account exists', () => {
  it('lists and direct reads', async () => {
    for (const path of [
      '/api/v1/accounts',
      '/api/v1/transactions',
      `/api/v1/transactions?search=zebra`,
      `/api/v1/transactions?tags=zebra-tag`,
      '/api/v1/transactions?limit=500',
      '/api/v1/people',
      `/api/v1/people/${pennyId}`,
      '/api/v1/goals',
      '/api/v1/budgets',
      '/api/v1/budgets/suggestions',
      '/api/v1/recurring',
      '/api/v1/reminders',
      '/api/v1/notifications',
      '/api/v1/loans',
      '/api/v1/categories?flat=true',
      '/api/v1/payees',
      '/api/v1/groups',
      '/api/v1/attachments',
      '/api/v1/audit-log',
      '/api/v1/detector/subscriptions',
      '/api/v1/tags',
      `/api/v1/tags/report?${range()}`,
    ]) {
      const res = await asMember().get(path);
      expect(res.status, path).toBeLessThan(500);
      assertNoLeak(path, res.body);
    }
    await asMember().get(`/api/v1/accounts/${zebraId}`).expect(404);
    await asMember().get(`/api/v1/accounts/${zebraId}/ledger`).expect(404);
    await asMember().get(`/api/v1/transactions/${zebraTxnId}`).expect(404);
  });

  it('the dashboard totals, accounts, month, cash flow, people and recent list exclude it', async () => {
    const own = (await as(owner).get('/api/v1/dashboard').expect(200)).body.data;
    const seen = (await asMember().get('/api/v1/dashboard').expect(200)).body.data;
    assertNoLeak('dashboard', seen);
    expect(seen.totalBalanceMinor).toBe(SHARED_BALANCE - rupees(777));
    expect(own.totalBalanceMinor).toBeGreaterThan(seen.totalBalanceMinor); // the owner sees more, as they should
    expect(seen.accounts.map((a: { name: string }) => a.name)).not.toContain('Zebra Vault');
    expect(seen.month.incomeMinor).toBe(SHARED_INCOME);
    expect(seen.month.expenseMinor).toBe(SHARED_EXPENSE);
    expect(seen.receivables.totalMinor).toBe(0); // Penny's loan was funded from the private account
    for (const path of ['/api/v1/dashboard/cash-flow?range=last_12_months', '/api/v1/dashboard/upcoming']) {
      assertNoLeak(path, (await asMember().get(path)).body);
    }
  });

  it('the cash book, with and without opening balances, excludes it', async () => {
    for (const view of ['single', 'double', 'triple']) {
      const res = await asMember().get(`/api/v1/cash-book?view=${view}&${range()}`).expect(200);
      assertNoLeak(`cash-book ${view}`, res.body);
      expect(res.body.data.closing.totalMinor).toBe(SHARED_BALANCE - rupees(777));
    }
  });

  it('every report excludes it', async () => {
    for (const path of [
      `/api/v1/reports/category?${range()}`,
      '/api/v1/reports/net-worth',
      '/api/v1/reports/monthly-comparison',
      '/api/v1/reports/borrow-lend',
      `/api/v1/reports/statement?${range()}`,
      '/api/v1/reports/accounts',
      `/api/v1/reports/profit-and-loss?${range()}`,
      '/api/v1/reports/ageing',
      `/api/v1/reports/gst-summary?${range()}`,
      `/api/v1/reports/person/${pennyId}`,
      '/api/v1/forecast?days=90',
    ]) {
      const res = await asMember().get(path);
      expect(res.status, path).toBeLessThan(500);
      assertNoLeak(path, res.body);
    }
    const net = (await asMember().get('/api/v1/reports/net-worth').expect(200)).body.data;
    expect(net.netWorthMinor).toBe(SHARED_BALANCE - rupees(777));
  });

  it("a person's balance and ledger do not include a loan funded from a private account", async () => {
    const people = (await asMember().get('/api/v1/people').expect(200)).body.data as Array<{ id: string; balanceMinor: number }>;
    expect(people.find((p) => p.id === pennyId)?.balanceMinor ?? 0).toBe(0);
    const ledger = await asMember().get(`/api/v1/people/${pennyId}/ledger`).expect(200);
    assertNoLeak('person ledger', ledger.body);
    expect(ledger.body.data.summary?.outstandingMinor ?? 0).toBe(0);
    const owned = (await as(owner).get('/api/v1/people').expect(200)).body.data as Array<{ id: string; balanceMinor: number }>;
    expect(owned.find((p) => p.id === pennyId)?.balanceMinor).toBe(ZEBRA_LOAN); // the owner still sees it
  });

  it('the CSV export, the people export and the full backup exclude it', async () => {
    for (const path of ['/api/v1/import-export/transactions.csv', `/api/v1/import-export/people/${pennyId}.csv`, '/api/v1/backup/export', '/api/v1/import-export/template']) {
      const res = await asMember().get(path);
      expect(res.status, path).toBeLessThan(500);
      assertNoLeak(path, res.text ?? res.body);
    }
  });

  it('exports for the owner still contain everything', async () => {
    const csv = (await as(owner).get('/api/v1/import-export/transactions.csv').expect(200)).text;
    expect(csv).toContain('Zebra purchase');
    expect(csv).toContain('Shared lunch');
  });

  it('integrity, closing and audit views do not name it', async () => {
    for (const path of ['/api/v1/integrity', `/api/v1/closing/day/preview?date=${new Date().toISOString()}`, '/api/v1/closing/month']) {
      const res = await asMember().get(path);
      expect(res.status, path).toBeLessThan(500);
      assertNoLeak(path, res.body);
    }
  });

  it('the shared money is still fully visible to the member (nothing over-hidden)', async () => {
    const list = (await asMember().get('/api/v1/transactions').expect(200)).body.data.items as Array<{ id: string; description: string }>;
    // The transfer into the private account is real activity on the shared Cash account, so it stays
    // in that ledger - as a masked entry that names neither the other account nor what it was for.
    expect(list.map((t) => t.description).sort()).toEqual(['Shared lunch', 'Shared salary', 'Transfer with a private account']);
    const masked = (await asMember().get('/api/v1/transactions').expect(200)).body.data.items.find((t: { isMasked?: boolean }) => t.isMasked);
    expect(masked.postings).toHaveLength(1);
    expect(masked.postings[0].accountId).toBe(cashId);
    expect(masked.tags).toEqual([]);
    await asMember().get(`/api/v1/transactions/${sharedTxnId}`).expect(200);
  });
});

describe('the shared side keeps adding up, and nothing private can be changed or reached by id', () => {
  it("the shared account's ledger still reconciles with its balance, with the transfer shown masked", async () => {
    const account = (await asMember().get(`/api/v1/accounts/${cashId}`).expect(200)).body.data;
    const ledger = (await asMember().get(`/api/v1/accounts/${cashId}/ledger`).expect(200)).body.data;
    assertNoLeak('shared account ledger', ledger);
    expect(account.balanceMinor).toBe(SHARED_BALANCE - rupees(777));
    const rows = ledger.rows as Array<{ description?: string; balanceMinor: number }>;
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows[rows.length - 1]!.balanceMinor).toBe(account.balanceMinor); // visible rows add up to the balance
    expect(rows.some((r) => r.description === 'Transfer with a private account')).toBe(true);
  });

  it('a member cannot edit, delete or restore the hidden transaction or the masked transfer, even with the id', async () => {
    const transfer = (await asMember().get('/api/v1/transactions').expect(200)).body.data.items.find((t: { isMasked?: boolean }) => t.isMasked);
    for (const id of [zebraTxnId, transfer.id]) {
      await asMember().patch(`/api/v1/transactions/${id}`).send({ rev: 1, description: 'tampered' }).expect(404);
      await asMember().delete(`/api/v1/transactions/${id}`).expect(404);
      await asMember().post(`/api/v1/transactions/${id}/restore`).expect(404);
    }
    // And nothing changed for the owner.
    const own = (await as(owner).get(`/api/v1/transactions/${zebraTxnId}`).expect(200)).body.data;
    expect(own.description).toBe('Zebra purchase');
    expect(own.deletedAt ?? null).toBeNull();
  });

  it('searching for a private description or tag finds nothing for another member, but works for the owner', async () => {
    const seen = (await asMember().get('/api/v1/transactions?search=Zebra').expect(200)).body.data;
    expect(seen.items).toHaveLength(0);
    const tagged = (await asMember().get('/api/v1/transactions?tags=zebra-tag').expect(200)).body.data;
    expect(tagged.items).toHaveLength(0);
    const own = (await as(owner).get('/api/v1/transactions?search=Zebra').expect(200)).body.data;
    expect(own.items.length).toBeGreaterThanOrEqual(2);
  });

  it('a receipt attached to a private transaction is invisible and unreachable to other members', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const uploaded = await as(owner)
      .post('/api/v1/attachments')
      .field('transactionId', zebraTxnId)
      .attach('file', png, { filename: 'zebra-receipt.png', contentType: 'image/png' })
      .expect(201);
    const attachmentId = uploaded.body.data.id as string;

    const vault = await asMember().get('/api/v1/attachments').expect(200);
    expect(JSON.stringify(vault.body)).not.toContain('zebra-receipt');
    await asMember().get(`/api/v1/attachments/${attachmentId}/download`).expect(404);
    await asMember().get(`/api/v1/attachments/${attachmentId}/thumbnail`).expect(404);
    await asMember().get(`/api/v1/attachments/transaction/${zebraTxnId}`).expect(200).then((r) => expect(r.body.data).toEqual([]));
    await asMember()
      .post('/api/v1/attachments')
      .field('transactionId', zebraTxnId)
      .attach('file', png, { filename: 'intrusion.png', contentType: 'image/png' })
      .expect(404);

    // The owner still has it.
    await as(owner).get(`/api/v1/attachments/${attachmentId}/download`).expect(200);
  });

  it("the audit trail shows a member nothing about the private account, and the owner everything", async () => {
    const own = (await as(owner).get('/api/v1/audit-log?limit=100').expect(200)).body.data.items as Array<{ summary: string }>;
    expect(own.some((e) => e.summary.includes('Zebra'))).toBe(true);
    assertNoLeak('audit log', (await asMember().get('/api/v1/audit-log?limit=100').expect(200)).body);
  });

  it('a private account that belongs to the viewer is fully visible to them', async () => {
    // The member makes their own private account; the owner must not see it, and the member must.
    const mine = (await asMember().post('/api/v1/accounts').send({ name: 'Quokka Fund', type: 'savings', openingBalanceMinor: rupees(1_000), visibility: 'private' }).expect(201)).body.data.id;
    const ownerList = JSON.stringify((await as(owner).get('/api/v1/accounts').expect(200)).body);
    expect(ownerList).not.toContain('Quokka');
    expect(JSON.stringify((await asMember().get('/api/v1/accounts').expect(200)).body)).toContain('Quokka');
    await as(owner).get(`/api/v1/accounts/${mine}`).set('X-Workspace-Id', owner.workspaceId).expect(404);
    const dash = (await as(owner).get('/api/v1/dashboard').expect(200)).body.data;
    expect(JSON.stringify(dash)).not.toContain('Quokka');
  });
});

describe('another member cannot attach anything to, or import into, a private account', () => {
  it('goal, budget, recurring and CSV import all treat it as non-existent', async () => {
    const expenseCat = (await asMember().get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id as string;
    const now = new Date().toISOString();

    expect((await asMember().post('/api/v1/goals').send({ name: 'Peek', targetMinor: rupees(10), linkedAccountId: zebraId })).status, 'goal').toBe(404);
    expect((await asMember().post('/api/v1/budgets').send({ name: 'Peek', categoryId: expenseCat, accountId: zebraId, amountMinor: rupees(10) })).status, 'budget').toBe(404);
    await asMember()
      .post('/api/v1/recurring')
      .send({ name: 'Peek', type: 'expense', amountMinor: rupees(10), accountId: zebraId, categoryId: expenseCat, frequency: 'monthly', startDate: now })
      .expect(404);

    const csv = `Date,Type,Amount,Account,Category,Description
${now.slice(0, 10)},expense,10,Zebra Vault,,Sneaky
`;
    const preview = await asMember().post('/api/v1/import-export/preview').attach('file', Buffer.from(csv), { filename: 'x.csv', contentType: 'text/csv' }).expect(200);
    expect(preview.body.data.validCount).toBe(0);
    expect(JSON.stringify(preview.body)).toMatch(/No account named/);
  });

  it('the owner can still use their own private account for all of those', async () => {
    const expenseCat = (await as(owner).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id as string;
    await as(owner).post('/api/v1/budgets').send({ name: 'Mine', categoryId: expenseCat, accountId: zebraId, amountMinor: rupees(5_000), period: 'weekly' }).expect(201);
    const goals = (await as(owner).get('/api/v1/goals').expect(200)).body.data as Array<{ name: string }>;
    expect(goals.map((g) => g.name)).toContain('Zebra goal');
    const budgets = (await as(owner).get('/api/v1/budgets').expect(200)).body.data as Array<{ name: string }>;
    expect(budgets.map((b) => b.name)).toContain('Zebra budget');
    const recurring = (await as(owner).get('/api/v1/recurring').expect(200)).body.data as Array<{ name: string }>;
    expect(recurring.map((r) => r.name)).toContain('Zebra rent');
  });

  it('a member cannot edit or delete the owner private goal, budget or recurring entry by id', async () => {
    const goal = ((await as(owner).get('/api/v1/goals').expect(200)).body.data as Array<{ id: string; name: string }>).find((g) => g.name === 'Zebra goal')!;
    const budget = ((await as(owner).get('/api/v1/budgets').expect(200)).body.data as Array<{ id: string; name: string }>).find((b) => b.name === 'Zebra budget')!;
    const rec = ((await as(owner).get('/api/v1/recurring').expect(200)).body.data as Array<{ id: string; name: string }>).find((r) => r.name === 'Zebra rent')!;
    await asMember().patch(`/api/v1/goals/${goal.id}`).send({ name: 'tampered', rev: 1 }).expect(404);
    await asMember().delete(`/api/v1/goals/${goal.id}`).expect(404);
    await asMember().patch(`/api/v1/budgets/${budget.id}`).send({ name: 'tampered', rev: 1 }).expect(404);
    await asMember().patch(`/api/v1/recurring/${rec.id}`).send({ name: 'tampered', rev: 1 }).expect(404);
    await asMember().delete(`/api/v1/recurring/${rec.id}`).expect(404);
  });
});
