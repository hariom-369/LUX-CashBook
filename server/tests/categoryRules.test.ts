import { beforeEach, describe, expect, it } from 'vitest';
import { Transaction } from '../src/models/index.js';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Category rules (§Phase 2): "if the description contains Jio, suggest Telecom", with a confidence
 * cue. A rule only suggests - it must never recategorise history, and matching must never be
 * driven by a pattern built from raw input.
 */

let user: TestUser;
let telecom: string;
let food: string;
let salary: string;

const suggest = async (query: string) => (await as(user).get(`/api/v1/category-rules/suggest?${query}`).expect(200)).body.data;
const makeRule = async (pattern: string, categoryId: string, field?: 'payee') =>
  as(user).post('/api/v1/category-rules').send({ pattern, categoryId, ...(field ? { field } : {}) });

beforeEach(async () => {
  user = await createTestUser();
  const cats = (await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data as Array<{ id: string; name: string }>;
  telecom = cats[0]!.id;
  food = cats[1]!.id;
  salary = ((await as(user).get('/api/v1/categories?kind=income&flat=true').expect(200)).body.data as Array<{ id: string }>)[0]!.id;
});

describe('managing rules', () => {
  it('creates, lists, updates and deletes a rule, normalising the text to lowercase', async () => {
    const created = (await makeRule('  JIO Fiber ', telecom).then((r) => r.status === 201 ? r : Promise.reject(r.body))).body.data;
    expect(created.pattern).toBe('jio fiber');
    expect(created.kind).toBe('expense');
    expect(created.hits).toBe(0);

    const list = (await as(user).get('/api/v1/category-rules').expect(200)).body.data as Array<{ id: string; categoryName: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]!.categoryName).toBeTruthy();

    const updated = (await as(user).patch(`/api/v1/category-rules/${created.id}`).send({ categoryId: food }).expect(200)).body.data;
    expect(updated.categoryId).toBe(food);

    await as(user).delete(`/api/v1/category-rules/${created.id}`).expect(204);
    expect(((await as(user).get('/api/v1/category-rules').expect(200)).body.data as unknown[]).length).toBe(0);
  });

  it('refuses a duplicate rule, a too-short pattern and a category from elsewhere', async () => {
    await makeRule('jio', telecom).then((r) => expect(r.status).toBe(201));
    const dupe = await makeRule('JIO', food);
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe('RULE_EXISTS');
    expect((await makeRule('a', telecom)).status).toBe(422);

    const other = await createTestUser();
    const foreignCat = ((await as(other).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data as Array<{ id: string }>)[0]!.id;
    expect((await makeRule('foreign', foreignCat)).status).toBe(404);
  });

  it("another workspace's rules are invisible and untouchable", async () => {
    const created = (await makeRule('jio', telecom)).body.data;
    const other = await createTestUser();
    expect(((await as(other).get('/api/v1/category-rules').expect(200)).body.data as unknown[]).length).toBe(0);
    await as(other).delete(`/api/v1/category-rules/${created.id}`).expect(404);
    await as(other).post(`/api/v1/category-rules/${created.id}/confirm`).expect(404);
  });
});

describe('suggestions', () => {
  it('suggests the rule\'s category when the text matches, ignoring case', async () => {
    await makeRule('jio', telecom);
    const hit = await suggest('description=Paid%20JIO%20recharge&kind=expense');
    expect(hit.categoryId).toBe(telecom);
    expect(hit.pattern).toBe('jio');
    expect(hit.confidence).toBe('medium');
  });

  it('suggests nothing - never a guess - when no rule matches, and for the wrong kind of entry', async () => {
    await makeRule('jio', telecom);
    expect(await suggest('description=Groceries&kind=expense')).toBeNull();
    expect(await suggest('description=Jio%20refund&kind=income')).toBeNull();
    expect(await suggest('kind=expense')).toBeNull();
  });

  it('prefers the longest (most specific) matching rule', async () => {
    await makeRule('jio', telecom);
    await makeRule('jio mart', food);
    expect((await suggest('description=Jio%20Mart%20order&kind=expense')).categoryId).toBe(food);
    expect((await suggest('description=Jio%20recharge&kind=expense')).categoryId).toBe(telecom);
  });

  it('matches the payee name for a payee rule, and only that field', async () => {
    await makeRule('swiggy', food, 'payee');
    expect((await suggest('payee=Swiggy%20Instamart&kind=expense')).categoryId).toBe(food);
    expect(await suggest('description=Swiggy&kind=expense')).toBeNull();
  });

  it('shows high confidence only for a rule accepted several times that matches a whole word', async () => {
    const rule = (await makeRule('jio', telecom)).body.data as { id: string };
    for (let i = 0; i < 3; i++) await as(user).post(`/api/v1/category-rules/${rule.id}/confirm`).expect(200);
    expect((await suggest('description=Jio%20recharge&kind=expense')).confidence).toBe('high');
    // "jio" inside a longer word is still a match, but not a whole-word one.
    expect((await suggest('description=Jiomart&kind=expense')).confidence).toBe('medium');
  });

  it('treats the rule text literally - regular-expression characters match only themselves', async () => {
    await makeRule('.*', telecom);
    expect(await suggest('description=Groceries&kind=expense')).toBeNull();
    expect((await suggest('description=wow%20.*%20thing&kind=expense')).categoryId).toBe(telecom);
    // a pathological backtracking input returns promptly
    const started = Date.now();
    await suggest(`description=${'a'.repeat(190)}!&kind=expense`);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('suggests nothing once the rule\'s category has been archived', async () => {
    await makeRule('jio', telecom);
    await as(user).patch(`/api/v1/categories/${telecom}`).send({ isArchived: true }).expect(200);
    expect(await suggest('description=Jio&kind=expense')).toBeNull();
  });
});

describe('rules never touch history', () => {
  it('creating, changing or confirming a rule leaves existing transactions exactly as they were', async () => {
    const wallet = (await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(5_000) }).expect(201)).body.data.id;
    const id = (
      await as(user)
        .post('/api/v1/transactions')
        .send({ type: 'expense', amountMinor: rupees(399), accountId: wallet, categoryId: food, date: new Date().toISOString(), description: 'Jio recharge' })
        .expect(201)
    ).body.data.id as string;
    const before = (await Transaction.findById(id).lean())!;

    const rule = (await makeRule('jio', telecom)).body.data as { id: string };
    await as(user).post(`/api/v1/category-rules/${rule.id}/confirm`).expect(200);
    await as(user).patch(`/api/v1/category-rules/${rule.id}`).send({ categoryId: salary === telecom ? food : food }).expect(200);

    const after = (await Transaction.findById(id).lean())!;
    expect(String(after.categoryId)).toBe(String(before.categoryId));
    expect(after.rev).toBe(before.rev);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it('an income rule only suggests for income entries', async () => {
    await makeRule('acme payroll', salary);
    expect((await suggest('description=ACME%20Payroll%20Oct&kind=income')).categoryId).toBe(salary);
    expect(await suggest('description=ACME%20Payroll%20Oct&kind=expense')).toBeNull();
  });
});
