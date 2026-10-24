import { beforeEach, describe, expect, it } from 'vitest';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/** Advanced transaction search: every filter at once, sorting, pagination — and only ever your own data. */

let user: TestUser;
let bank: string;
let wallet: string;
let food: string;
let travel: string;
let ravi: string;

async function record(body: Record<string, unknown>) {
  return (await as(user).post('/api/v1/transactions').send({ accountId: bank, ...body }).expect(201)).body.data.id as string;
}
const list = async (query: string, who = user) => (await as(who).get(`/api/v1/transactions?${query}`).expect(200)).body.data;

beforeEach(async () => {
  user = await createTestUser();
  bank = (await as(user).post('/api/v1/accounts').send({ name: 'Bank', type: 'bank', openingBalanceMinor: rupees(100_000) }).expect(201)).body.data.id;
  wallet = (await as(user).post('/api/v1/accounts').send({ name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(10_000) }).expect(201)).body.data.id;
  const expense = (await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data;
  food = expense[0].id;
  travel = expense[1].id;
  ravi = (await as(user).post('/api/v1/people').send({ name: 'Ravi' }).expect(201)).body.data.id;
});

describe('combined filters', () => {
  let ids: Record<string, string>;

  beforeEach(async () => {
    ids = {
      lunch: await record({ type: 'expense', amountMinor: rupees(450), date: '2026-09-05T12:00:00', categoryId: food, description: 'Team lunch' }),
      dinner: await record({ type: 'expense', amountMinor: rupees(1_800), date: '2026-09-12T20:00:00', categoryId: food, description: 'Dinner out' }),
      lunchWallet: await record({ type: 'expense', amountMinor: rupees(300), date: '2026-09-15T12:00:00', categoryId: food, description: 'Lunch', accountId: wallet }),
      cab: await record({ type: 'expense', amountMinor: rupees(900), date: '2026-09-20T09:00:00', categoryId: travel, description: 'Cab to airport' }),
      octLunch: await record({ type: 'expense', amountMinor: rupees(500), date: '2026-10-02T12:00:00', categoryId: food, description: 'Lunch' }),
    };
    ids.lend = (await as(user).post(`/api/v1/people/${ravi}/lend`).send({ amountMinor: rupees(700), accountId: bank, date: '2026-09-18T10:00:00' }).expect(201)).body.data.id;
  });

  it('applies date range, amount range, category, account, type and text search together', async () => {
    const q = [
      'from=2026-09-01T00:00:00.000Z',
      'to=2026-09-30T23:59:59.999Z',
      `categoryIds=${food}`,
      `accountIds=${bank}`,
      'types=expense',
      `minAmountMinor=${rupees(400)}`,
      `maxAmountMinor=${rupees(2_000)}`,
      'search=lunch',
    ].join('&');
    expect((await list(q)).items.map((t: { id: string }) => t.id)).toEqual([ids.lunch]);
  });

  it('filters by person, and narrows as each filter is added', async () => {
    expect((await list(`personIds=${ravi}`)).items.map((t: { id: string }) => t.id)).toEqual([ids.lend]);
    expect((await list('search=lunch')).total).toBe(3);
    expect((await list(`search=lunch&accountIds=${wallet}`)).total).toBe(1);
    expect((await list(`categoryIds=${food},${travel}&from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.999Z`)).total).toBe(4);
  });

  it('sorts by amount or date in either direction, and pages through the results', async () => {
    const byAmount = await list('types=expense&sortBy=amount&sortOrder=asc');
    expect(byAmount.items.map((t: { amountMinor: number }) => t.amountMinor)).toEqual([300, 450, 500, 900, 1_800].map(rupees));

    const page1 = await list('types=expense&sortBy=date&sortOrder=desc&limit=2&page=1');
    const page2 = await list('types=expense&sortBy=date&sortOrder=desc&limit=2&page=2');
    expect(page1).toMatchObject({ total: 5, totalPages: 3, hasMore: true });
    expect(page1.items.map((t: { id: string }) => t.id)).toEqual([ids.octLunch, ids.cab]);
    expect(page2.items.map((t: { id: string }) => t.id)).toEqual([ids.lunchWallet, ids.dinner]);
  });

  it('with no filters at all, returns everything again', async () => {
    expect((await list('')).total).toBe(6);
  });

  it('never returns another workspace\'s transactions, even when asked for their account or category', async () => {
    const other = await createTestUser();
    expect((await list(`accountIds=${bank}&categoryIds=${food}`, other)).items).toEqual([]);
    expect((await list('search=lunch', other)).total).toBe(0);
  });

  it('rejects malformed filters instead of guessing', async () => {
    await as(user).get('/api/v1/transactions?accountIds=not-an-id').expect(422);
    await as(user).get('/api/v1/transactions?sortBy=colour').expect(422);
    await as(user).get('/api/v1/transactions?minAmountMinor=lots').expect(422);
  });
});
