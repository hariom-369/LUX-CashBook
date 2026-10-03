import { beforeEach, describe, expect, it } from 'vitest';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Phase 12 (business operations): profit & loss, receivables/payables
 * ageing, petty cash cash-counts, and basic inventory. All of these are
 * business-mode-only (`requireBusinessMode`), same convention as the
 * existing petty cash / closing tests in `phase4.test.ts`.
 */

let user: TestUser;
let bizHeaders: { 'X-Workspace-Id': string };

beforeEach(async () => {
  user = await createTestUser();
  const business = await as(user).post('/api/v1/workspaces').send({ name: 'Shop', mode: 'business', currency: 'INR' }).expect(201);
  bizHeaders = { 'X-Workspace-Id': business.body.data.id };
});

describe('profit & loss', () => {
  it('nets income against expense for the range', async () => {
    const bank = (await as(user).post('/api/v1/accounts').set(bizHeaders).send({ name: 'Bank', type: 'bank', openingBalanceMinor: 0 }).expect(201)).body.data.id;
    const incomeCat = (await as(user).get('/api/v1/categories?kind=income&flat=true').set(bizHeaders).expect(200)).body.data[0].id;
    const expenseCat = (await as(user).get('/api/v1/categories?kind=expense&flat=true').set(bizHeaders).expect(200)).body.data[0].id;
    const today = new Date().toISOString();

    await as(user).post('/api/v1/transactions').set(bizHeaders).send({ type: 'income', amountMinor: rupees(10_000), date: today, accountId: bank, categoryId: incomeCat }).expect(201);
    await as(user).post('/api/v1/transactions').set(bizHeaders).send({ type: 'expense', amountMinor: rupees(4_000), date: today, accountId: bank, categoryId: expenseCat }).expect(201);

    const pnl = await as(user).get('/api/v1/reports/profit-and-loss?range=this_month').set(bizHeaders).expect(200);
    expect(pnl.body.data.income.totalMinor).toBe(rupees(10_000));
    expect(pnl.body.data.expense.totalMinor).toBe(rupees(4_000));
    expect(pnl.body.data.netProfitMinor).toBe(rupees(6_000));
  });
});

describe('receivables/payables ageing', () => {
  it('buckets an overdue invoice and an overdue loan together under receivables', async () => {
    const customer = (await as(user).post('/api/v1/people').set(bizHeaders).send({ name: 'Acme Co', relationship: 'customer' }).expect(201)).body.data.id;
    const bank = (await as(user).post('/api/v1/accounts').set(bizHeaders).send({ name: 'Bank', type: 'bank', openingBalanceMinor: 0 }).expect(201)).body.data.id;

    // An invoice 45 days overdue → the 31-60 bucket.
    const overdueDate = new Date(Date.now() - 45 * 86400000).toISOString();
    const invoice = await as(user)
      .post('/api/v1/invoices')
      .set(bizHeaders)
      .send({
        personId: customer,
        issueDate: new Date(Date.now() - 60 * 86400000).toISOString(),
        dueDate: overdueDate,
        items: [{ description: 'Work', quantity: 1, rateMinor: rupees(5_000) }],
      })
      .expect(201);
    await as(user).post(`/api/v1/invoices/${invoice.body.data.id}/send`).set(bizHeaders).expect(200);

    // A lend 10 days overdue → the 0-30 bucket.
    await as(user)
      .post('/api/v1/transactions')
      .set(bizHeaders)
      .send({ type: 'lend', amountMinor: rupees(2_000), accountId: bank, personId: customer, date: new Date().toISOString(), dueDate: new Date(Date.now() - 10 * 86400000).toISOString(), description: 'Loan' })
      .expect(201);

    const ageing = await as(user).get('/api/v1/reports/ageing?direction=receivable').set(bizHeaders).expect(200);
    expect(ageing.body.data.totalMinor).toBe(rupees(7_000));
    expect(ageing.body.data.totalsByBucket['31_60']).toBe(rupees(5_000));
    expect(ageing.body.data.totalsByBucket['0_30']).toBe(rupees(2_000));
    expect(ageing.body.data.rows.find((r: { source: string }) => r.source === 'invoice').referenceLabel).toBe(invoice.body.data.number);
  });

  it('a borrow with a past due date appears under payables', async () => {
    const lender = (await as(user).post('/api/v1/people').set(bizHeaders).send({ name: 'Supplier Co', relationship: 'supplier' }).expect(201)).body.data.id;
    const bank = (await as(user).post('/api/v1/accounts').set(bizHeaders).send({ name: 'Bank', type: 'bank', openingBalanceMinor: 0 }).expect(201)).body.data.id;

    await as(user)
      .post('/api/v1/transactions')
      .set(bizHeaders)
      .send({ type: 'borrow', amountMinor: rupees(3_000), accountId: bank, personId: lender, date: new Date().toISOString(), dueDate: new Date(Date.now() - 5 * 86400000).toISOString(), description: 'Credit' })
      .expect(201);

    const ageing = await as(user).get('/api/v1/reports/ageing?direction=payable').set(bizHeaders).expect(200);
    expect(ageing.body.data.totalMinor).toBe(rupees(3_000));
    expect(ageing.body.data.totalsByBucket['0_30']).toBe(rupees(3_000));
  });
});

describe('petty cash cash counts', () => {
  it('records a count against the live expected figure and surfaces it in the daily report', async () => {
    const drawer = (await as(user).post('/api/v1/accounts').set(bizHeaders).send({ name: 'Drawer', type: 'cash', openingBalanceMinor: rupees(5_000) }).expect(201)).body.data.id;
    const bank = (await as(user).post('/api/v1/accounts').set(bizHeaders).send({ name: 'Bank', type: 'bank', openingBalanceMinor: rupees(50_000) }).expect(201)).body.data.id;
    const pettyCash = (await as(user).post('/api/v1/petty-cash').set(bizHeaders).send({ accountId: drawer, imprestMinor: rupees(5_000), replenishFromAccountId: bank }).expect(201)).body.data.id;

    const expenseCat = (await as(user).get('/api/v1/categories?kind=expense&flat=true').set(bizHeaders).expect(200)).body.data[0].id;
    await as(user).post('/api/v1/transactions').set(bizHeaders).send({ type: 'expense', amountMinor: rupees(800), date: new Date().toISOString(), accountId: drawer, categoryId: expenseCat }).expect(201);

    // Expected is now 5000 - 800 = 4200; the custodian counts 4150 — a shortfall of 50.
    const count = await as(user).post(`/api/v1/petty-cash/${pettyCash}/count`).set(bizHeaders).send({ countedMinor: rupees(4_150) }).expect(201);
    expect(count.body.data.expectedMinor).toBe(rupees(4_200));
    expect(count.body.data.differenceMinor).toBe(-rupees(50));

    const report = await as(user).get(`/api/v1/petty-cash/${pettyCash}/report`).set(bizHeaders).expect(200);
    expect(report.body.data.spendByCategory.reduce((sum: number, r: { amountMinor: number }) => sum + r.amountMinor, 0)).toBe(rupees(800));
    expect(report.body.data.recentCounts).toHaveLength(1);
    expect(report.body.data.recentCounts[0].differenceMinor).toBe(-rupees(50));
  });
});

describe('inventory', () => {
  it('refuses a duplicate SKU in the same workspace', async () => {
    await as(user).post('/api/v1/products').set(bizHeaders).send({ name: 'Widget', sku: 'WID-001', unitPriceMinor: rupees(100) }).expect(201);
    await as(user).post('/api/v1/products').set(bizHeaders).send({ name: 'Widget 2', sku: 'wid-001', unitPriceMinor: rupees(150) }).expect(409);
  });

  it('stock in/out/adjustment move stockQty, and out refuses to oversell', async () => {
    const product = (await as(user).post('/api/v1/products').set(bizHeaders).send({ name: 'Widget', sku: 'WID-002', unitPriceMinor: rupees(100), lowStockThreshold: 5 }).expect(201)).body.data;
    expect(product.stockQty).toBe(0);
    expect(product.isLowStock).toBe(true);

    const afterIn = await as(user).post(`/api/v1/products/${product.id}/movements`).set(bizHeaders).send({ type: 'in', quantity: 20 }).expect(201);
    expect(afterIn.body.data.product.stockQty).toBe(20);
    expect(afterIn.body.data.movement.quantity).toBe(20);
    expect(afterIn.body.data.product.isLowStock).toBe(false);

    const afterOut = await as(user).post(`/api/v1/products/${product.id}/movements`).set(bizHeaders).send({ type: 'out', quantity: 17 }).expect(201);
    expect(afterOut.body.data.product.stockQty).toBe(3);
    expect(afterOut.body.data.product.isLowStock).toBe(true);

    // Only 3 left — selling 10 more is refused, and stock is unchanged.
    await as(user).post(`/api/v1/products/${product.id}/movements`).set(bizHeaders).send({ type: 'out', quantity: 10 }).expect(409);
    const unchanged = await as(user).get(`/api/v1/products/${product.id}`).set(bizHeaders).expect(200);
    expect(unchanged.body.data.stockQty).toBe(3);

    const afterAdjustment = await as(user).post(`/api/v1/products/${product.id}/movements`).set(bizHeaders).send({ type: 'adjustment', quantity: -3, note: 'Damaged stock' }).expect(201);
    expect(afterAdjustment.body.data.product.stockQty).toBe(0);

    const movements = await as(user).get(`/api/v1/products/${product.id}/movements`).set(bizHeaders).expect(200);
    expect(movements.body.data).toHaveLength(3);
  });

  it('is only available in a business workspace', async () => {
    await as(user).get('/api/v1/products').expect(403);
  });

  it('never leaks a product across workspaces', async () => {
    const outsider = await createTestUser();
    const product = await as(user).post('/api/v1/products').set(bizHeaders).send({ name: 'Widget', sku: 'WID-003', unitPriceMinor: rupees(100) }).expect(201);
    // The outsider isn't a member of this business workspace, so requireWorkspace itself refuses — same 404 as nonexistent.
    await as(outsider).get(`/api/v1/products/${product.body.data.id}`).set(bizHeaders).expect(404);
  });
});
