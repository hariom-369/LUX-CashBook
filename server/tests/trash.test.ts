import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { anon, as, createTestUser, realImage, rupees, type TestUser } from './helpers.js';
import {
  Account,
  Attachment,
  Budget,
  ExpenseGroup,
  GroupExpense,
  Invitation,
  Person,
  RecurringTransaction,
  SystemMarker,
  Transaction,
} from '../src/models/index.js';
import { purgeExpiredTrash } from '../src/modules/trash/trash.service.js';
import { processDueRecurring } from '../src/modules/recurring/recurring.service.js';
import { getStorageDriver } from '../src/lib/storage.js';

/**
 * Trash / Recently Deleted (§Trash): soft deletion, restore exactly once, 30-day automatic
 * purge, permanent deletion, dependencies — and that balances and reports follow every step.
 */

let user: TestUser;
let bank: string;
let food: string;

const DAY = 24 * 60 * 60 * 1000;
const today = () => new Date().toISOString();
const balanceOf = async (accountId: string) => (await as(user).get(`/api/v1/accounts/${accountId}`).expect(200)).body.data.balanceMinor as number;
const trash = async (query = '') => (await as(user).get(`/api/v1/trash${query}`).expect(200)).body;
const trashKeys = async (query = '') => (await trash(query)).data.items.map((i: { type: string; id: string }) => `${i.type}:${i.id}`);
const restore = (type: string, id: string, who = user) => as(who).post(`/api/v1/trash/${type}/${id}/restore`);
const forever = (type: string, id: string, who = user) => as(who).delete(`/api/v1/trash/${type}/${id}`).send({ confirm: true });
const dashboardExpense = async () => (await as(user).get('/api/v1/dashboard').expect(200)).body.data.month.expenseMinor as number;

async function spend(amount: number, accountId = bank, description = 'Lunch') {
  return (
    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(amount), date: today(), accountId, categoryId: food, description })
      .expect(201)
  ).body.data.id as string;
}

/** Pretend it was deleted `days` ago, as if that much time had passed. */
async function ageDeletion(model: { updateOne: (...args: never[]) => unknown }, id: string, days: number) {
  await (model.updateOne as (f: unknown, u: unknown) => Promise<unknown>)({ _id: new Types.ObjectId(id) }, { $set: { deletedAt: new Date(Date.now() - days * DAY) } });
}

beforeEach(async () => {
  // As if Trash had been running for a long time (see the legacy-records test for the opposite).
  await SystemMarker.updateOne({ key: 'trash.launchedAt' }, { $set: { at: new Date(Date.now() - 365 * DAY) } }, { upsert: true });
  user = await createTestUser();
  bank = (await as(user).post('/api/v1/accounts').send({ name: 'Bank', type: 'bank', openingBalanceMinor: rupees(10_000) }).expect(201)).body.data.id;
  food = (await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id;
});

afterEach(() => vi.restoreAllMocks());

describe('moving to Trash', () => {
  it('takes a deleted transaction out of balances and reports, and lists it with its 30-day countdown', async () => {
    const id = await spend(2_500);
    expect(await balanceOf(bank)).toBe(rupees(7_500));

    await as(user).delete(`/api/v1/transactions/${id}`).expect(200);
    expect(await balanceOf(bank)).toBe(rupees(10_000));
    expect(await dashboardExpense()).toBe(0);
    const live = await as(user).get('/api/v1/transactions').expect(200);
    expect(live.body.data.items).toHaveLength(0);

    const body = await trash();
    expect(body.meta.retentionDays).toBe(30);
    const [item] = body.data.items;
    expect(item).toMatchObject({ type: 'transaction', id, name: 'Lunch', amountMinor: rupees(2_500), daysRemaining: 30 });
    expect(new Date(item.expiresAt).getTime() - new Date(item.deletedAt).getTime()).toBe(30 * DAY);
  });

  it('collects every supported type, and each disappears from its own list', async () => {
    const txn = await spend(100);
    await as(user).delete(`/api/v1/transactions/${txn}`).expect(200);

    const spare = (await as(user).post('/api/v1/accounts').send({ name: 'Spare wallet', type: 'cash' }).expect(201)).body.data.id;
    await as(user).delete(`/api/v1/accounts/${spare}`).expect(200);

    const person = (await as(user).post('/api/v1/people').send({ name: 'Asha' }).expect(201)).body.data.id;
    const groupMember = (await as(user).post('/api/v1/people').send({ name: 'Ravi' }).expect(201)).body.data.id;
    await as(user).delete(`/api/v1/people/${person}`).expect(200);

    const group = (await as(user).post('/api/v1/groups').send({ name: 'Trip', memberPersonIds: [groupMember] }).expect(201)).body.data.id;
    await as(user).delete(`/api/v1/groups/${group}`).expect(200);

    const budget = (await as(user).post('/api/v1/budgets').send({ name: 'Food', categoryId: food, amountMinor: rupees(5_000), period: 'monthly' }).expect(201)).body.data.id;
    await as(user).delete(`/api/v1/budgets/${budget}`).expect(200);

    const goal = (await as(user).post('/api/v1/goals').send({ name: 'Laptop', targetMinor: rupees(80_000) }).expect(201)).body.data.id;
    await as(user).delete(`/api/v1/goals/${goal}`).expect(200);

    const recurring = (
      await as(user)
        .post('/api/v1/recurring')
        .send({ name: 'Rent', type: 'expense', amountMinor: rupees(1_000), accountId: bank, frequency: 'monthly', dayOfMonth: 5, startDate: today() })
        .expect(201)
    ).body.data.id;
    await as(user).delete(`/api/v1/recurring/${recurring}`).expect(200);

    const reminder = (await as(user).post('/api/v1/reminders').send({ title: 'Insurance', type: 'custom', dueDate: today() }).expect(201)).body.data.id;
    await as(user).delete(`/api/v1/reminders/${reminder}`).expect(200);

    const doc = (
      await as(user)
        .post('/api/v1/attachments')
        .field('docType', 'warranty')
        .field('title', 'Fridge warranty')
        .attach('file', await realImage('jpeg'), { filename: 'warranty.jpg', contentType: 'image/jpeg' })
        .expect(201)
    ).body.data.id;
    await as(user).delete(`/api/v1/attachments/${doc}`).expect(200);

    expect((await trashKeys()).sort()).toEqual(
      [
        `transaction:${txn}`, `account:${spare}`, `person:${person}`, `group:${group}`, `budget:${budget}`,
        `goal:${goal}`, `recurring:${recurring}`, `reminder:${reminder}`, `document:${doc}`,
      ].sort(),
    );
    expect((await as(user).get('/api/v1/budgets').expect(200)).body.data).toHaveLength(0);
    expect((await as(user).get('/api/v1/goals').expect(200)).body.data).toHaveLength(0);
    expect((await as(user).get('/api/v1/reminders').expect(200)).body.data).toHaveLength(0);
    expect((await as(user).get('/api/v1/groups').expect(200)).body.data).toHaveLength(0);
    await as(user).get(`/api/v1/groups/${group}`).expect(404);

    // …and every one of them comes back.
    const restored = await as(user)
      .post('/api/v1/trash/restore')
      .send({ items: (await trash()).data.items.map((i: { type: string; id: string }) => ({ type: i.type, id: i.id })) })
      .expect(200);
    expect(restored.body.data.every((r: { ok: boolean }) => r.ok)).toBe(true);
    expect((await trash()).data.items).toHaveLength(0);
    expect((await as(user).get('/api/v1/budgets').expect(200)).body.data).toHaveLength(1);
    expect((await as(user).get('/api/v1/goals').expect(200)).body.data).toHaveLength(1);
    expect((await as(user).get('/api/v1/reminders').expect(200)).body.data).toHaveLength(1);
    expect((await as(user).get(`/api/v1/groups/${group}`).expect(200)).body.data.name).toBe('Trip');
    expect((await as(user).get('/api/v1/recurring').expect(200)).body.data.map((r: { id: string }) => r.id)).toContain(recurring);
  });

  it('frees a budget\'s category straight away, so a new budget can be made for it', async () => {
    const budget = (await as(user).post('/api/v1/budgets').send({ name: 'Food', categoryId: food, amountMinor: rupees(5_000), period: 'monthly' }).expect(201)).body.data.id;
    await as(user).delete(`/api/v1/budgets/${budget}`).expect(200);
    await as(user).post('/api/v1/budgets').send({ name: 'Food v2', categoryId: food, amountMinor: rupees(6_000), period: 'monthly' }).expect(201);

    // The old one can't come back over the new one; it says why.
    const res = await restore('budget', budget).expect(409);
    expect(res.body.error.code).toBe('TRASH_NAME_TAKEN');
  });
});

describe('restoring', () => {
  it('brings a transaction back under the same id, putting its money back exactly once', async () => {
    const id = await spend(2_500);
    await as(user).delete(`/api/v1/transactions/${id}`).expect(200);

    await restore('transaction', id).expect(200);
    expect(await balanceOf(bank)).toBe(rupees(7_500));
    expect(await dashboardExpense()).toBe(rupees(2_500));
    expect((await as(user).get(`/api/v1/transactions/${id}`).expect(200)).body.data.id).toBe(id);

    // A repeat of the same request changes nothing.
    await restore('transaction', id).expect(404);
    expect(await balanceOf(bank)).toBe(rupees(7_500));
  });

  it('applies concurrent restores and concurrent deletes only once', async () => {
    const id = await spend(2_000);

    const deletes = await Promise.all([1, 2, 3].map(() => as(user).delete(`/api/v1/transactions/${id}`)));
    expect(deletes.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await balanceOf(bank)).toBe(rupees(10_000));

    const restores = await Promise.all([1, 2, 3].map(() => restore('transaction', id)));
    expect(restores.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await balanceOf(bank)).toBe(rupees(8_000));
  });

  it('refuses anything past its 30 days, and no longer lists it', async () => {
    const id = await spend(500);
    await as(user).delete(`/api/v1/transactions/${id}`).expect(200);
    await ageDeletion(Transaction, id, 31);

    expect(await trashKeys()).toEqual([]);
    const res = await restore('transaction', id).expect(409);
    expect(res.body.error.code).toBe('TRASH_EXPIRED');
    expect(await balanceOf(bank)).toBe(rupees(10_000));
  });

  it('needs the account a transaction was recorded on restored first', async () => {
    const wallet = (await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(1_000) }).expect(201)).body.data.id;
    const id = await spend(200, wallet);
    await as(user).delete(`/api/v1/transactions/${id}`).expect(200);
    await as(user).delete(`/api/v1/accounts/${wallet}`).expect(200); // nothing live on it now

    expect((await restore('transaction', id).expect(409)).body.error.code).toBe('ACCOUNT_IN_TRASH');
    await restore('account', wallet).expect(200);
    await restore('transaction', id).expect(200);
    expect(await balanceOf(wallet)).toBe(rupees(800));
  });

  it('says so when something with the same name has taken its place', async () => {
    const asha = (await as(user).post('/api/v1/people').send({ name: 'Asha' }).expect(201)).body.data.id;
    await as(user).delete(`/api/v1/people/${asha}`).expect(200);
    await as(user).post('/api/v1/people').send({ name: 'Asha' }).expect(201);
    expect((await restore('person', asha).expect(409)).body.error.code).toBe('TRASH_NAME_TAKEN');
  });

  it('brings a recurring entry back without back-posting what fell due while it was in Trash', async () => {
    const id = (
      await as(user)
        .post('/api/v1/recurring')
        .send({ name: 'Gym', type: 'expense', amountMinor: rupees(1_000), accountId: bank, frequency: 'weekly', startDate: today() })
        .expect(201)
    ).body.data.id;
    await as(user).delete(`/api/v1/recurring/${id}`).expect(200);
    await RecurringTransaction.updateOne({ _id: id }, { $set: { nextRunDate: new Date(Date.now() - 20 * DAY) } });

    await restore('recurring', id).expect(200);
    const restored = await RecurringTransaction.findById(id).lean();
    expect(restored!.isActive).toBe(true);
    expect(restored!.nextRunDate.getTime()).toBeGreaterThanOrEqual(Date.now() - 1000);

    await processDueRecurring(new Date());
    expect(await balanceOf(bank)).toBe(rupees(10_000));
  });

  it('brings a group back exactly as it was, and never touches the money in your books', async () => {
    const ravi = (await as(user).post('/api/v1/people').send({ name: 'Ravi' }).expect(201)).body.data.id;
    const group = (await as(user).post('/api/v1/groups').send({ name: 'Trip', memberPersonIds: [ravi] }).expect(201)).body.data.id;
    await as(user)
      .post(`/api/v1/groups/${group}/expenses`)
      .send({ description: 'Dinner', date: today(), accountId: bank, splitMethod: 'equal', totalAmountMinor: rupees(1_000), participants: [{ personId: null }, { personId: ravi }] })
      .expect(201);

    await as(user).delete(`/api/v1/groups/${group}`).expect(200);
    expect(await balanceOf(bank)).toBe(rupees(9_000)); // the real money stays put
    await restore('group', group).expect(200);

    const summary = await as(user).get(`/api/v1/groups/${group}/summary`).expect(200);
    expect(summary.body.data.expenseCount).toBe(1);
    expect(summary.body.data.suggestions).toEqual([expect.objectContaining({ fromPersonId: ravi, amountMinor: rupees(500) })]);
    expect(await balanceOf(bank)).toBe(rupees(9_000));
  });

  it('leaves out a group expense\'s own entries, which can only come back with it', async () => {
    const ravi = (await as(user).post('/api/v1/people').send({ name: 'Ravi' }).expect(201)).body.data.id;
    const group = (await as(user).post('/api/v1/groups').send({ name: 'Trip', memberPersonIds: [ravi] }).expect(201)).body.data.id;
    const expense = (
      await as(user)
        .post(`/api/v1/groups/${group}/expenses`)
        .send({ description: 'Dinner', date: today(), accountId: bank, splitMethod: 'equal', totalAmountMinor: rupees(1_000), participants: [{ personId: null }, { personId: ravi }] })
        .expect(201)
    ).body.data;
    await as(user).delete(`/api/v1/groups/${group}/expenses/${expense.id}`).expect(200);

    expect(await trashKeys('?type=transaction')).toEqual([]);
    const lend = expense.memberShares[0].transactionId;
    expect((await as(user).post(`/api/v1/transactions/${lend}/restore`).expect(409)).body.error.code).toBe('GROUP_ENTRY');
    expect(await balanceOf(bank)).toBe(rupees(10_000));
  });
});

describe('who can see and do what', () => {
  it('never shows or touches another workspace\'s Trash', async () => {
    const id = await spend(300);
    await as(user).delete(`/api/v1/transactions/${id}`).expect(200);

    const other = await createTestUser();
    expect((await as(other).get('/api/v1/trash').expect(200)).body.data.items).toEqual([]);
    await restore('transaction', id, other).expect(404);
    await forever('transaction', id, other).expect(404);
    await as(other).post('/api/v1/trash/empty').send({ confirm: true }).expect(200);
    expect(await trashKeys()).toEqual([`transaction:${id}`]);
    await anon().get('/api/v1/trash').expect(401);
  });

  it('lets a member restore but only the owner or an admin permanently delete; a viewer can do neither', async () => {
    const id = await spend(300);
    await as(user).delete(`/api/v1/transactions/${id}`).expect(200);

    const member = await joinAs('member');
    const viewer = await joinAs('viewer');
    const inWorkspace = (u: TestUser) => ({ ...u, workspaceId: user.workspaceId });

    expect((await as(inWorkspace(viewer)).get('/api/v1/trash').expect(200)).body.data.items).toHaveLength(1);
    await restore('transaction', id, inWorkspace(viewer)).expect(403);
    await forever('transaction', id, inWorkspace(member)).expect(403);
    await as(inWorkspace(member)).post('/api/v1/trash/empty').send({ confirm: true }).expect(403);
    await restore('transaction', id, inWorkspace(member)).expect(200);
  });
});

async function joinAs(role: 'member' | 'viewer'): Promise<TestUser> {
  const invitee = await createTestUser();
  await as(user).post('/api/v1/workspace-invitations').send({ email: invitee.email, role }).expect(201);
  const invitation = await Invitation.findOne({ workspaceId: user.workspaceId, email: invitee.email }).select('+tokenHash');
  const { generateActionToken, hashToken } = await import('../src/lib/tokens.js');
  const { token } = generateActionToken();
  invitation!.tokenHash = hashToken(token);
  await invitation!.save();
  await as(invitee).post(`/api/v1/invitations/${token}/accept`).expect(200);
  return invitee;
}

describe('permanent deletion', () => {
  it('requires an explicit confirmation, then erases the item for good', async () => {
    const id = await spend(400);
    await as(user).delete(`/api/v1/transactions/${id}`).expect(200);

    await as(user).delete(`/api/v1/trash/transaction/${id}`).send({}).expect(422);
    await forever('transaction', id).expect(200);
    expect(await Transaction.exists({ _id: id })).toBeNull();
    await restore('transaction', id).expect(404);
    expect(await balanceOf(bank)).toBe(rupees(10_000)); // its money was already reversed when it was deleted
  });

  it('empties Trash, keeping anything other records still need', async () => {
    const asha = (await as(user).post('/api/v1/people').send({ name: 'Asha' }).expect(201)).body.data.id;
    await as(user).post(`/api/v1/people/${asha}/lend`).send({ amountMinor: rupees(100), accountId: bank }).expect(201);
    await as(user).post(`/api/v1/people/${asha}/repay`).send({ amountMinor: rupees(100), accountId: bank }).expect(201);
    await as(user).delete(`/api/v1/people/${asha}`).expect(200); // settled, but her history stays

    const a = await spend(10);
    const b = await spend(20);
    await as(user).delete(`/api/v1/transactions/${a}`).expect(200);
    await as(user).delete(`/api/v1/transactions/${b}`).expect(200);

    await as(user).post('/api/v1/trash/empty').send({}).expect(422);
    const res = await as(user).post('/api/v1/trash/empty').send({ confirm: true }).expect(200);
    expect(res.body.data).toEqual({ deleted: 2, kept: 1 });
    expect(await trashKeys()).toEqual([`person:${asha}`]);
    expect((await forever('person', asha).expect(409)).body.error.code).toBe('TRASH_ITEM_IN_USE');
    expect(await Transaction.countDocuments({ personId: asha })).toBe(2); // her lend and repayment, untouched
  });
});

describe('automatic purge after 30 days', () => {
  it('permanently deletes expired items of every kind, and only expired ones', async () => {
    const old = await spend(10, bank, 'Old');
    const recent = await spend(20, bank, 'Recent');
    await as(user).delete(`/api/v1/transactions/${old}`).expect(200);
    await as(user).delete(`/api/v1/transactions/${recent}`).expect(200);
    await ageDeletion(Transaction, old, 31);
    await ageDeletion(Transaction, recent, 29);

    const budget = (await as(user).post('/api/v1/budgets').send({ name: 'Food', categoryId: food, amountMinor: rupees(5_000), period: 'monthly' }).expect(201)).body.data.id;
    await as(user).delete(`/api/v1/budgets/${budget}`).expect(200);
    await ageDeletion(Budget, budget, 30.01);

    const stats = await purgeExpiredTrash();
    expect(stats.purged).toBeGreaterThanOrEqual(2);
    expect(await Transaction.exists({ _id: old })).toBeNull();
    expect(await Budget.exists({ _id: budget })).toBeNull();
    expect(await Transaction.exists({ _id: recent })).not.toBeNull();
    expect(await trashKeys()).toEqual([`transaction:${recent}`]);
    expect(await balanceOf(bank)).toBe(rupees(10_000));

    // Running again is harmless.
    expect((await purgeExpiredTrash()).purged).toBe(0);
  });

  it('keeps — hidden and no longer restorable — what other records still point to', async () => {
    const asha = (await as(user).post('/api/v1/people').send({ name: 'Asha' }).expect(201)).body.data.id;
    await as(user).post(`/api/v1/people/${asha}/lend`).send({ amountMinor: rupees(100), accountId: bank }).expect(201);
    await as(user).post(`/api/v1/people/${asha}/repay`).send({ amountMinor: rupees(100), accountId: bank }).expect(201);
    await as(user).delete(`/api/v1/people/${asha}`).expect(200);
    await ageDeletion(Person, asha, 31);

    const stats = await purgeExpiredTrash();
    expect(stats.kept).toBe(1);
    const kept = await Person.findById(asha).lean();
    expect(kept!.trashRetainedAt).toBeInstanceOf(Date);
    expect(await trashKeys()).toEqual([]);
    expect((await restore('person', asha).expect(409)).body.error.code).toBe('TRASH_EXPIRED');
    expect((await as(user).get(`/api/v1/people/${asha}/ledger`).expect(404)).status).toBe(404);
  });

  it('waits for an account until the deleted transactions on it are gone, then removes it', async () => {
    const wallet = (await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(1_000) }).expect(201)).body.data.id;
    const id = await spend(200, wallet);
    await as(user).delete(`/api/v1/transactions/${id}`).expect(200);
    await as(user).delete(`/api/v1/accounts/${wallet}`).expect(200);
    await ageDeletion(Account, wallet, 31);

    // The transaction is still within its 30 days, so the account waits rather than being kept forever.
    let stats = await purgeExpiredTrash();
    expect(stats.waiting).toBe(1);
    expect(await Account.exists({ _id: wallet })).not.toBeNull();

    await ageDeletion(Transaction, id, 31);
    stats = await purgeExpiredTrash();
    expect(await Transaction.exists({ _id: id })).toBeNull();
    expect(await Account.exists({ _id: wallet })).toBeNull();
  });

  it('removes a purged transaction\'s receipt, file and all', async () => {
    const id = await spend(50);
    const receipt = (
      await as(user)
        .post('/api/v1/attachments')
        .field('transactionId', id)
        .attach('file', await realImage('jpeg'), { filename: 'bill.jpg', contentType: 'image/jpeg' })
        .expect(201)
    ).body.data.id;
    const stored = await Attachment.findById(receipt).lean();
    await as(user).delete(`/api/v1/transactions/${id}`).expect(200);
    await ageDeletion(Transaction, id, 31);

    await purgeExpiredTrash();
    expect(await Attachment.exists({ _id: receipt })).toBeNull();
    expect(await getStorageDriver().exists(stored!.storageKey)).toBe(false);
  });

  it('carries on past one failure and retries it next run; a file that won\'t delete keeps its record', async () => {
    const a = await spend(10);
    const b = await spend(20);
    await as(user).delete(`/api/v1/transactions/${a}`).expect(200);
    await as(user).delete(`/api/v1/transactions/${b}`).expect(200);
    await ageDeletion(Transaction, a, 31);
    await ageDeletion(Transaction, b, 31);

    const doc = (
      await as(user)
        .post('/api/v1/attachments')
        .field('docType', 'warranty')
        .attach('file', await realImage('jpeg'), { filename: 'w.jpg', contentType: 'image/jpeg' })
        .expect(201)
    ).body.data.id;
    await as(user).delete(`/api/v1/attachments/${doc}`).expect(200);
    await ageDeletion(Attachment, doc, 31);

    // The database refuses one delete, and storage claims the file is still there.
    vi.spyOn(Transaction, 'deleteOne').mockRejectedValueOnce(new Error('connection reset'));
    const driver = getStorageDriver();
    const exists = vi.spyOn(Object.getPrototypeOf(driver), 'exists').mockResolvedValue(true);

    const first = await purgeExpiredTrash();
    expect(first.failed).toBe(1);
    expect(first.purged).toBe(1); // the other transaction went
    expect(await Attachment.exists({ _id: doc })).not.toBeNull(); // file "still there": record kept

    exists.mockRestore();
    const second = await purgeExpiredTrash();
    expect(second.purged).toBe(2);
    expect(await Transaction.countDocuments({ _id: { $in: [a, b] } })).toBe(0);
    expect(await Attachment.exists({ _id: doc })).toBeNull();
  });

  it('never purges transactions deleted long before Trash existed — they stay soft-deleted, as promised then', async () => {
    await SystemMarker.updateOne({ key: 'trash.launchedAt' }, { $set: { at: new Date() } }); // Trash launches now
    const legacy = await spend(70, bank, 'Deleted in 2025');
    await as(user).delete(`/api/v1/transactions/${legacy}`).expect(200);
    await ageDeletion(Transaction, legacy, 400);

    const stats = await purgeExpiredTrash();
    expect(stats.purged).toBe(0);
    const row = await Transaction.findById(legacy).lean();
    expect(row!.deletedAt).toBeInstanceOf(Date);
    expect(row!.trashRetainedAt).toBeNull();
  });

  it('never purges a group\'s transactions with the group', async () => {
    const ravi = (await as(user).post('/api/v1/people').send({ name: 'Ravi' }).expect(201)).body.data.id;
    const group = (await as(user).post('/api/v1/groups').send({ name: 'Trip', memberPersonIds: [ravi] }).expect(201)).body.data.id;
    await as(user)
      .post(`/api/v1/groups/${group}/expenses`)
      .send({ description: 'Dinner', date: today(), accountId: bank, splitMethod: 'equal', totalAmountMinor: rupees(1_000), participants: [{ personId: null }, { personId: ravi }] })
      .expect(201);
    await as(user).delete(`/api/v1/groups/${group}`).expect(200);
    await ageDeletion(ExpenseGroup, group, 31);

    await purgeExpiredTrash();
    expect(await ExpenseGroup.exists({ _id: group })).toBeNull();
    expect(await GroupExpense.countDocuments({ groupId: group })).toBe(0);
    expect(await Transaction.countDocuments({ workspaceId: user.workspaceId, deletedAt: null })).toBe(2);
    expect(await balanceOf(bank)).toBe(rupees(9_000));
  });
});

describe('finding things in Trash', () => {
  it('searches by name, filters by type and pages through results', async () => {
    for (const d of ['Coffee', 'Groceries', 'Coffee beans']) {
      await as(user).delete(`/api/v1/transactions/${await spend(10, bank, d)}`).expect(200);
    }
    const goal = (await as(user).post('/api/v1/goals').send({ name: 'Coffee machine', targetMinor: rupees(9_000) }).expect(201)).body.data.id;
    await as(user).delete(`/api/v1/goals/${goal}`).expect(200);

    expect((await trash('?q=coffee')).data.total).toBe(3);
    expect((await trash('?q=coffee&type=goal')).data.items.map((i: { id: string }) => i.id)).toEqual([goal]);
    const page2 = (await trash('?limit=3&page=2')).data;
    expect(page2).toMatchObject({ total: 4, page: 2, totalPages: 2 });
    expect(page2.items).toHaveLength(1);
    await as(user).get('/api/v1/trash?type=spaceship').expect(422);
  });
});
