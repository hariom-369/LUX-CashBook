import { beforeEach, describe, expect, it } from 'vitest';
import { anon, as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Group expense splitting where any member can pay (extends Phase 8's groups):
 * balances, settle-up suggestions, partial payments, edits and deletions — and,
 * above all, that your own books only ever see your share as an expense, with
 * everything else as loans and repayments that no report counts as income or
 * expense.
 */

let user: TestUser;
let bank: string;
let food: string;
let alice: string;
let bob: string;
let groupId: string;

const today = () => new Date().toISOString();
const balanceOf = async (accountId: string) => (await as(user).get(`/api/v1/accounts/${accountId}`).expect(200)).body.data.balanceMinor as number;
const owedBy = async (personId: string) => (await as(user).get(`/api/v1/people/${personId}/ledger`).expect(200)).body.data.summary.outstandingMinor as number;
const summary = async () => (await as(user).get(`/api/v1/groups/${groupId}/summary`).expect(200)).body.data;
const transactionCount = async () => (await as(user).get('/api/v1/transactions').expect(200)).body.data.items.length as number;

type Suggestion = { fromPersonId: string | null; toPersonId: string | null; amountMinor: number };
const suggestionsOf = (data: { suggestions: Suggestion[] }) =>
  data.suggestions.map((s) => `${s.fromPersonId ?? 'me'}->${s.toPersonId ?? 'me'}:${s.amountMinor}`).sort();

function addExpense(body: Record<string, unknown>) {
  return as(user).post(`/api/v1/groups/${groupId}/expenses`).send({ date: today(), description: 'Expense', ...body });
}

beforeEach(async () => {
  user = await createTestUser();
  bank = (await as(user).post('/api/v1/accounts').send({ name: 'Bank', type: 'bank', openingBalanceMinor: rupees(50_000) }).expect(201)).body.data.id;
  food = (await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id;
  alice = (await as(user).post('/api/v1/people').send({ name: 'Alice' }).expect(201)).body.data.id;
  bob = (await as(user).post('/api/v1/people').send({ name: 'Bob' }).expect(201)).body.data.id;
  groupId = (await as(user).post('/api/v1/groups').send({ name: 'Goa Trip', memberPersonIds: [alice, bob] }).expect(201)).body.data.id;
});

describe('an expense another member paid', () => {
  it('records only your share as an expense, as a debt to the payer, and leaves the account balance untouched', async () => {
    await addExpense({
      description: 'Hotel', accountId: bank, categoryId: food, paidByPersonId: alice,
      splitMethod: 'equal', totalAmountMinor: rupees(3_000),
      participants: [{ personId: null }, { personId: alice }, { personId: bob }],
    }).expect(201);

    expect(await balanceOf(bank)).toBe(rupees(50_000));
    expect(await owedBy(alice)).toBe(-rupees(1_000)); // you owe Alice your share
    expect(await owedBy(bob)).toBe(0); // Bob owes Alice, not you

    const dashboard = (await as(user).get('/api/v1/dashboard').expect(200)).body.data;
    expect(dashboard.month.expenseMinor).toBe(rupees(1_000));
    expect(dashboard.month.incomeMinor).toBe(0);
  });

  it('touches none of your books when you were not part of it', async () => {
    await addExpense({
      description: 'Their cab', paidByPersonId: alice,
      splitMethod: 'equal', totalAmountMinor: rupees(600),
      participants: [{ personId: alice }, { personId: bob }],
    }).expect(201);

    expect(await transactionCount()).toBe(0);
    expect(await owedBy(alice)).toBe(0);
    expect(await owedBy(bob)).toBe(0);
    const s = await summary();
    expect(suggestionsOf(s)).toEqual([`${bob}->${alice}:${rupees(300)}`]);
  });

  it('asks for an account when you have a share, and refuses a payer who is not a member', async () => {
    await addExpense({
      paidByPersonId: alice, splitMethod: 'equal', totalAmountMinor: rupees(100),
      participants: [{ personId: null }, { personId: alice }],
    }).expect(400);

    const carol = (await as(user).post('/api/v1/people').send({ name: 'Carol' }).expect(201)).body.data.id;
    await addExpense({
      accountId: bank, paidByPersonId: carol, splitMethod: 'equal', totalAmountMinor: rupees(100),
      participants: [{ personId: null }, { personId: alice }],
    }).expect(400);
  });
});

describe('balances and settle-up suggestions', () => {
  beforeEach(async () => {
    // You paid 3,000 for all three; Alice paid 600 for herself and Bob; Bob paid 900 — 300 yours, 600 Alice's.
    await addExpense({ accountId: bank, categoryId: food, splitMethod: 'equal', totalAmountMinor: rupees(3_000), participants: [{ personId: null }, { personId: alice }, { personId: bob }] }).expect(201);
    await addExpense({ paidByPersonId: alice, splitMethod: 'equal', totalAmountMinor: rupees(600), participants: [{ personId: alice }, { personId: bob }] }).expect(201);
    await addExpense({ accountId: bank, categoryId: food, paidByPersonId: bob, splitMethod: 'exact', totalAmountMinor: rupees(900), participants: [{ personId: null, value: rupees(300) }, { personId: alice, value: rupees(600) }] }).expect(201);
  });

  it('computes every member\'s paid, fair share and net, summing to zero', async () => {
    const s = await summary();
    const byId = Object.fromEntries(s.positions.map((p: { personId: string | null }) => [p.personId ?? 'me', p]));
    expect(byId.me).toMatchObject({ paidMinor: rupees(3_000), shareMinor: rupees(1_300), netMinor: rupees(1_700) });
    expect(byId[alice]).toMatchObject({ paidMinor: rupees(600), shareMinor: rupees(1_900), netMinor: -rupees(1_300) });
    expect(byId[bob]).toMatchObject({ paidMinor: rupees(900), shareMinor: rupees(1_300), netMinor: -rupees(400) });
    expect(s.positions.reduce((sum: number, p: { netMinor: number }) => sum + p.netMinor, 0)).toBe(0);
    expect(s.totalSpentMinor).toBe(rupees(4_500));
    expect(s.expenseCount).toBe(3);
  });

  it('suggests direct amounts with you — matching each person\'s ledger — and simplifies the rest', async () => {
    const s = await summary();
    expect(suggestionsOf(s)).toEqual(
      [`${alice}->me:${rupees(1_000)}`, `${bob}->me:${rupees(700)}`, `${alice}->${bob}:${rupees(300)}`].sort(),
    );
    expect(await owedBy(alice)).toBe(rupees(1_000));
    expect(await owedBy(bob)).toBe(rupees(700));
  });

  it('counts only your own shares in the expense report — never a member\'s share or a loan', async () => {
    const report = await as(user).get('/api/v1/reports/category?kind=expense').expect(200);
    const total = report.body.data.reduce((sum: number, row: { amountMinor: number }) => sum + row.amountMinor, 0);
    expect(total).toBe(rupees(1_300));
    const dashboard = (await as(user).get('/api/v1/dashboard').expect(200)).body.data;
    expect(dashboard.month.incomeMinor).toBe(0);
    // Cash really out of the bank: only the 3,000 you paid.
    expect(await balanceOf(bank)).toBe(rupees(50_000) - rupees(3_000));
  });

  it('records a partial payment to you, then the rest, and the group is settled', async () => {
    await as(user).post(`/api/v1/groups/${groupId}/settlements`).send({ fromPersonId: bob, toPersonId: null, amountMinor: rupees(300), date: today(), accountId: bank }).expect(201);
    expect(suggestionsOf(await summary())).toContain(`${bob}->me:${rupees(400)}`);
    expect(await owedBy(bob)).toBe(rupees(400));
    expect(await balanceOf(bank)).toBe(rupees(47_000) + rupees(300));

    await as(user).post(`/api/v1/groups/${groupId}/settlements`).send({ fromPersonId: bob, toPersonId: null, amountMinor: rupees(400), date: today(), accountId: bank }).expect(201);
    await as(user).post(`/api/v1/groups/${groupId}/settlements`).send({ fromPersonId: alice, toPersonId: null, amountMinor: rupees(1_000), date: today(), accountId: bank }).expect(201);
    await as(user).post(`/api/v1/groups/${groupId}/settlements`).send({ fromPersonId: alice, toPersonId: bob, amountMinor: rupees(300), date: today() }).expect(201);

    const s = await summary();
    expect(s.suggestions).toEqual([]);
    expect(s.settlements).toHaveLength(4);
    expect(s.positions.every((p: { netMinor: number }) => p.netMinor === 0)).toBe(true);
    expect(await owedBy(alice)).toBe(0);
    expect(await owedBy(bob)).toBe(0);
    expect(await balanceOf(bank)).toBe(rupees(47_000) + rupees(1_700));
  });

  it('refuses a payment larger than what is owed, in every direction', async () => {
    const post = (body: Record<string, unknown>) => as(user).post(`/api/v1/groups/${groupId}/settlements`).send({ date: today(), ...body });
    await post({ fromPersonId: bob, toPersonId: null, amountMinor: rupees(701), accountId: bank }).expect(400);
    await post({ fromPersonId: null, toPersonId: alice, amountMinor: rupees(1), accountId: bank }).expect(400); // you owe Alice nothing
    await post({ fromPersonId: alice, toPersonId: bob, amountMinor: rupees(301) }).expect(400);
    await post({ fromPersonId: bob, toPersonId: bob, amountMinor: rupees(1) }).expect(400);
    await post({ fromPersonId: bob, toPersonId: null, amountMinor: rupees(100) }).expect(400); // no account
  });

  it('a payment between two other members never touches your books', async () => {
    const before = await transactionCount();
    await as(user).post(`/api/v1/groups/${groupId}/settlements`).send({ fromPersonId: alice, toPersonId: bob, amountMinor: rupees(300), date: today() }).expect(201);
    expect(await transactionCount()).toBe(before);
    expect(await balanceOf(bank)).toBe(rupees(47_000));
  });

  it('deleting a payment restores the balance, the account and the person\'s ledger', async () => {
    const created = await as(user).post(`/api/v1/groups/${groupId}/settlements`).send({ fromPersonId: alice, toPersonId: null, amountMinor: rupees(500), date: today(), accountId: bank }).expect(201);
    expect(await owedBy(alice)).toBe(rupees(500));

    await as(user).delete(`/api/v1/groups/${groupId}/settlements/${created.body.data.id}`).expect(200);
    expect(await owedBy(alice)).toBe(rupees(1_000));
    expect(await balanceOf(bank)).toBe(rupees(47_000));
    const s = await summary();
    expect(s.settlements).toHaveLength(0);
    expect(suggestionsOf(s)).toContain(`${alice}->me:${rupees(1_000)}`);
  });
});

describe('editing and deleting', () => {
  let expenseId: string;
  const base = { description: 'Dinner', accountId: bank, categoryId: food, splitMethod: 'equal', totalAmountMinor: rupees(3_000) };

  beforeEach(async () => {
    expenseId = (await addExpense({ ...base, accountId: bank, participants: [{ personId: null }, { personId: alice }, { personId: bob }] }).expect(201)).body.data.id;
  });

  it('re-splits an edited expense, replacing its transactions so every balance follows', async () => {
    const res = await as(user)
      .put(`/api/v1/groups/${groupId}/expenses/${expenseId}`)
      .send({ ...base, accountId: bank, date: today(), totalAmountMinor: rupees(2_000), splitMethod: 'percentage', participants: [{ personId: null, value: 50 }, { personId: alice, value: 50 }] })
      .expect(200);
    expect(res.body.data.splitInputs).toEqual([{ personId: null, value: 50 }, { personId: alice, value: 50 }]);

    expect(await balanceOf(bank)).toBe(rupees(48_000));
    expect(await owedBy(alice)).toBe(rupees(1_000));
    expect(await owedBy(bob)).toBe(0); // excluded from the edited expense
    const dashboard = (await as(user).get('/api/v1/dashboard').expect(200)).body.data;
    expect(dashboard.month.expenseMinor).toBe(rupees(1_000));
  });

  it('can switch the payer to another member', async () => {
    await as(user)
      .put(`/api/v1/groups/${groupId}/expenses/${expenseId}`)
      .send({ ...base, accountId: bank, date: today(), paidByPersonId: bob, participants: [{ personId: null }, { personId: alice }, { personId: bob }] })
      .expect(200);
    expect(await balanceOf(bank)).toBe(rupees(50_000));
    expect(await owedBy(bob)).toBe(-rupees(1_000));
    expect(await owedBy(alice)).toBe(0);
  });

  it('allows fixing the description after a payment, but not the money until that payment is removed', async () => {
    const payment = await as(user).post(`/api/v1/groups/${groupId}/settlements`).send({ fromPersonId: alice, toPersonId: null, amountMinor: rupees(500), date: today(), accountId: bank }).expect(201);
    const participants = [{ personId: null }, { personId: alice }, { personId: bob }];

    await as(user).put(`/api/v1/groups/${groupId}/expenses/${expenseId}`).send({ ...base, accountId: bank, date: today(), description: 'Team dinner', participants }).expect(200);
    const listed = await as(user).get(`/api/v1/groups/${groupId}/expenses`).expect(200);
    expect(listed.body.data[0].description).toBe('Team dinner');

    const blocked = await as(user).put(`/api/v1/groups/${groupId}/expenses/${expenseId}`).send({ ...base, accountId: bank, date: today(), totalAmountMinor: rupees(1_500), participants }).expect(409);
    expect(blocked.body.error.code).toBe('GROUP_EXPENSE_SETTLED');
    await as(user).delete(`/api/v1/groups/${groupId}/expenses/${expenseId}`).expect(409);
    // Nothing moved while refusing.
    expect(await owedBy(alice)).toBe(rupees(500));
    expect(await balanceOf(bank)).toBe(rupees(47_500));

    await as(user).delete(`/api/v1/groups/${groupId}/settlements/${payment.body.data.id}`).expect(200);
    await as(user).put(`/api/v1/groups/${groupId}/expenses/${expenseId}`).send({ ...base, accountId: bank, date: today(), totalAmountMinor: rupees(1_500), participants }).expect(200);
    expect(await owedBy(alice)).toBe(rupees(500));
  });

  it('deleting an expense a member paid removes your share and your debt to them', async () => {
    const theirs = await addExpense({ accountId: bank, categoryId: food, paidByPersonId: alice, splitMethod: 'equal', totalAmountMinor: rupees(800), participants: [{ personId: null }, { personId: alice }] }).expect(201);
    expect(await owedBy(alice)).toBe(rupees(1_000) - rupees(400));

    await as(user).delete(`/api/v1/groups/${groupId}/expenses/${theirs.body.data.id}`).expect(200);
    expect(await owedBy(alice)).toBe(rupees(1_000));
    expect(await balanceOf(bank)).toBe(rupees(47_000));
    const dashboard = (await as(user).get('/api/v1/dashboard').expect(200)).body.data;
    expect(dashboard.month.expenseMinor).toBe(rupees(1_000));
    expect((await summary()).expenseCount).toBe(1);
  });
});

describe('rounding and validation', () => {
  it('splits an amount that does not divide evenly without losing or inventing a paisa', async () => {
    await addExpense({ accountId: bank, splitMethod: 'equal', totalAmountMinor: 10_000, participants: [{ personId: null }, { personId: alice }, { personId: bob }] }).expect(201);
    const s = await summary();
    const shares = s.positions.map((p: { shareMinor: number }) => p.shareMinor).sort();
    expect(shares.reduce((a: number, b: number) => a + b, 0)).toBe(10_000);
    expect(shares).toEqual([3_333, 3_333, 3_334]);
    expect(s.positions.reduce((sum: number, p: { netMinor: number }) => sum + p.netMinor, 0)).toBe(0);
  });

  it('refuses percentages that do not add up to 100, and the same person twice', async () => {
    await addExpense({ accountId: bank, splitMethod: 'percentage', totalAmountMinor: rupees(100), participants: [{ personId: null, value: 50 }, { personId: alice, value: 40 }] }).expect(400);
    await addExpense({ accountId: bank, splitMethod: 'equal', totalAmountMinor: rupees(100), participants: [{ personId: alice }, { personId: alice }] }).expect(400);
    expect(await transactionCount()).toBe(0);
  });

  it('records an expense only once when the same request is retried', async () => {
    const body = { date: today(), description: 'Retry', accountId: bank, splitMethod: 'equal', totalAmountMinor: rupees(300), participants: [{ personId: null }, { personId: alice }] };
    await as(user).post(`/api/v1/groups/${groupId}/expenses`).set('Idempotency-Key', 'group-expense-retry-1').send(body).expect(201);
    await as(user).post(`/api/v1/groups/${groupId}/expenses`).set('Idempotency-Key', 'group-expense-retry-1').send(body).expect(201);
    expect((await summary()).expenseCount).toBe(1);
    expect(await owedBy(alice)).toBe(rupees(150));
  });
});

describe('members', () => {
  it('renames a group, adds a member, and removes one nothing refers to', async () => {
    const carol = (await as(user).post('/api/v1/people').send({ name: 'Carol' }).expect(201)).body.data.id;
    await as(user).patch(`/api/v1/groups/${groupId}`).send({ name: 'Goa 2026' }).expect(200);
    const added = await as(user).post(`/api/v1/groups/${groupId}/members`).send({ personIds: [carol] }).expect(200);
    expect(added.body.data.name).toBe('Goa 2026');
    expect(added.body.data.memberPersonIds).toEqual([alice, bob, carol]);

    const removed = await as(user).delete(`/api/v1/groups/${groupId}/members/${carol}`).expect(200);
    expect(removed.body.data.memberPersonIds).toEqual([alice, bob]);
  });

  it('will not remove a member who is part of a recorded expense', async () => {
    await addExpense({ accountId: bank, splitMethod: 'equal', totalAmountMinor: rupees(100), participants: [{ personId: null }, { personId: bob }] }).expect(201);
    const res = await as(user).delete(`/api/v1/groups/${groupId}/members/${bob}`).expect(409);
    expect(res.body.error.code).toBe('GROUP_MEMBER_IN_USE');
  });
});

describe('deleting a group', () => {
  it('removes it from the list but keeps everything already in your books', async () => {
    await addExpense({ accountId: bank, categoryId: food, splitMethod: 'equal', totalAmountMinor: rupees(1_000), participants: [{ personId: null }, { personId: alice }] }).expect(201);
    const before = await transactionCount();

    await as(user).delete(`/api/v1/groups/${groupId}`).expect(200);

    const groups = await as(user).get('/api/v1/groups').expect(200);
    expect(groups.body.data.map((g: { id: string }) => g.id)).not.toContain(groupId);
    expect(await transactionCount()).toBe(before);
    expect(await balanceOf(bank)).toBe(rupees(49_000));
    expect(await owedBy(alice)).toBe(rupees(500));
  });

  it('cannot be done from another workspace', async () => {
    const other = await createTestUser();
    await as(other).delete(`/api/v1/groups/${groupId}`).expect(404);
    const groups = await as(user).get('/api/v1/groups').expect(200);
    expect(groups.body.data.map((g: { id: string }) => g.id)).toContain(groupId);
  });
});

describe('access', () => {
  it('requires sign-in and never reaches another workspace\'s group', async () => {
    await anon().get(`/api/v1/groups/${groupId}/summary`).expect(401);
    const other = await createTestUser();
    await as(other).get(`/api/v1/groups/${groupId}/summary`).expect(404);
    await as(other).post(`/api/v1/groups/${groupId}/settlements`).send({ fromPersonId: alice, toPersonId: bob, amountMinor: rupees(1), date: today() }).expect(404);
    await as(other).patch(`/api/v1/groups/${groupId}`).send({ name: 'Mine now' }).expect(404);
    await as(other).delete(`/api/v1/groups/${groupId}/members/${alice}`).expect(404);
  });
});
