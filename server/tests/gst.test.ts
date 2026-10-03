import { beforeEach, describe, expect, it } from 'vitest';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Phase 13 (GST-ready data): intra- vs inter-state GST splitting, inclusive
 * pricing, HSN/SAC codes, and a GST summary report. No filing or return
 * claims are made anywhere — this is a summary to hand to an accountant,
 * not a GSTR submission (see `docs/ROADMAP_PHASE13_NOTES.md`).
 */

let user: TestUser;
let bizHeaders: { 'X-Workspace-Id': string };

beforeEach(async () => {
  user = await createTestUser();
  const business = await as(user).post('/api/v1/workspaces').send({ name: 'Shop', mode: 'business', currency: 'INR' }).expect(201);
  bizHeaders = { 'X-Workspace-Id': business.body.data.id };
});

describe('workspace and customer GST profile', () => {
  it('round-trips the business profile — name, address, GSTIN and state', async () => {
    const updated = await as(user)
      .patch(`/api/v1/workspaces/${bizHeaders['X-Workspace-Id']}`)
      .send({ businessName: 'Acme Traders', businessAddress: '12 MG Road', gstin: '29ABCDE1234F1Z5', state: 'Karnataka' })
      .expect(200);

    expect(updated.body.data.businessName).toBe('Acme Traders');
    expect(updated.body.data.gstin).toBe('29ABCDE1234F1Z5');
    expect(updated.body.data.state).toBe('Karnataka');

    const refetched = await as(user).get(`/api/v1/workspaces/${bizHeaders['X-Workspace-Id']}`).expect(200);
    expect(refetched.body.data.state).toBe('Karnataka');
  });

  it('round-trips a customer\'s GSTIN and state', async () => {
    const customer = await as(user).post('/api/v1/people').set(bizHeaders).send({ name: 'Acme Co', relationship: 'customer', gstin: '27AAACB1234C1Z5', state: 'Maharashtra' }).expect(201);
    expect(customer.body.data.gstin).toBe('27AAACB1234C1Z5');
    expect(customer.body.data.state).toBe('Maharashtra');
  });
});

async function setupWorkspaceState(state: string) {
  await as(user).patch(`/api/v1/workspaces/${bizHeaders['X-Workspace-Id']}`).send({ state }).expect(200);
}

let customerCounter = 0;
async function createCustomer(state?: string) {
  customerCounter += 1;
  const res = await as(user).post('/api/v1/people').set(bizHeaders).send({ name: `Customer ${customerCounter}`, relationship: 'customer', state }).expect(201);
  return res.body.data.id;
}

describe('invoice GST splitting', () => {
  it('splits CGST+SGST evenly when supplier and customer share a state', async () => {
    await setupWorkspaceState('Karnataka');
    const customer = await createCustomer('Karnataka');

    const invoice = await as(user)
      .post('/api/v1/invoices')
      .set(bizHeaders)
      .send({
        personId: customer,
        issueDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 86400000 * 14).toISOString(),
        items: [{ description: 'Service', quantity: 1, rateMinor: rupees(10_000), hsnCode: '998313' }],
        taxPercent: 18,
      })
      .expect(201);

    expect(invoice.body.data.taxMinor).toBe(rupees(1_800));
    expect(invoice.body.data.gst.cgstMinor).toBe(rupees(900));
    expect(invoice.body.data.gst.sgstMinor).toBe(rupees(900));
    expect(invoice.body.data.gst.igstMinor).toBe(0);
    expect(invoice.body.data.placeOfSupplyState).toBe('Karnataka');
    expect(invoice.body.data.items[0].hsnCode).toBe('998313');
  });

  it('charges the whole amount as IGST when supplier and customer are in different states', async () => {
    await setupWorkspaceState('Karnataka');
    const customer = await createCustomer('Maharashtra');

    const invoice = await as(user)
      .post('/api/v1/invoices')
      .set(bizHeaders)
      .send({
        personId: customer,
        issueDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 86400000 * 14).toISOString(),
        items: [{ description: 'Service', quantity: 1, rateMinor: rupees(10_000) }],
        taxPercent: 18,
      })
      .expect(201);

    expect(invoice.body.data.gst.cgstMinor).toBe(0);
    expect(invoice.body.data.gst.sgstMinor).toBe(0);
    expect(invoice.body.data.gst.igstMinor).toBe(rupees(1_800));
  });

  it('defaults to IGST (never guesses intra-state) when either state is unknown', async () => {
    const customer = await createCustomer(); // no state set, and workspace has no state either

    const invoice = await as(user)
      .post('/api/v1/invoices')
      .set(bizHeaders)
      .send({
        personId: customer,
        issueDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 86400000 * 14).toISOString(),
        items: [{ description: 'Service', quantity: 1, rateMinor: rupees(1_000) }],
        taxPercent: 18,
      })
      .expect(201);

    expect(invoice.body.data.gst.igstMinor).toBe(invoice.body.data.taxMinor);
    expect(invoice.body.data.gst.cgstMinor).toBe(0);
  });

  it('recomputes the GST split when the customer changes to one in a different state', async () => {
    await setupWorkspaceState('Karnataka');
    const sameState = await createCustomer('Karnataka');
    const otherState = await createCustomer('Maharashtra');

    const invoice = await as(user)
      .post('/api/v1/invoices')
      .set(bizHeaders)
      .send({
        personId: sameState,
        issueDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 86400000 * 14).toISOString(),
        items: [{ description: 'Service', quantity: 1, rateMinor: rupees(1_000) }],
        taxPercent: 18,
      })
      .expect(201);
    expect(invoice.body.data.gst.igstMinor).toBe(0);

    const updated = await as(user).patch(`/api/v1/invoices/${invoice.body.data.id}`).set(bizHeaders).send({ personId: otherState }).expect(200);
    expect(updated.body.data.gst.cgstMinor).toBe(0);
    expect(updated.body.data.gst.igstMinor).toBe(updated.body.data.taxMinor);
  });

  it('inclusive pricing backs the taxable value out of a tax-inclusive rate', async () => {
    const customer = await createCustomer();

    // A rate of 11,800 inclusive of 18% tax implies a taxable value of 10,000 and tax of 1,800.
    const invoice = await as(user)
      .post('/api/v1/invoices')
      .set(bizHeaders)
      .send({
        personId: customer,
        issueDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 86400000 * 14).toISOString(),
        items: [{ description: 'Service', quantity: 1, rateMinor: rupees(11_800) }],
        taxPercent: 18,
        priceType: 'inclusive',
      })
      .expect(201);

    expect(invoice.body.data.subtotalMinor).toBe(rupees(10_000));
    expect(invoice.body.data.taxMinor).toBe(rupees(1_800));
    expect(invoice.body.data.totalMinor).toBe(rupees(11_800));
  });
});

describe('GST summary report', () => {
  it('aggregates tax collected by rate across issued invoices, excluding drafts', async () => {
    await setupWorkspaceState('Karnataka');
    const customer = await createCustomer('Karnataka');
    const today = new Date().toISOString();

    const sent18 = await as(user)
      .post('/api/v1/invoices')
      .set(bizHeaders)
      .send({ personId: customer, issueDate: today, dueDate: today, items: [{ description: 'A', quantity: 1, rateMinor: rupees(10_000) }], taxPercent: 18 })
      .expect(201);
    await as(user).post(`/api/v1/invoices/${sent18.body.data.id}/send`).set(bizHeaders).expect(200);

    const sent5 = await as(user)
      .post('/api/v1/invoices')
      .set(bizHeaders)
      .send({ personId: customer, issueDate: today, dueDate: today, items: [{ description: 'B', quantity: 1, rateMinor: rupees(2_000) }], taxPercent: 5 })
      .expect(201);
    await as(user).post(`/api/v1/invoices/${sent5.body.data.id}/send`).set(bizHeaders).expect(200);

    // A draft invoice must never be counted.
    await as(user)
      .post('/api/v1/invoices')
      .set(bizHeaders)
      .send({ personId: customer, issueDate: today, dueDate: today, items: [{ description: 'C', quantity: 1, rateMinor: rupees(50_000) }], taxPercent: 28 })
      .expect(201);

    const summary = await as(user).get('/api/v1/reports/gst-summary?range=this_month').set(bizHeaders).expect(200);
    expect(summary.body.data.rows).toHaveLength(2);
    const row18 = summary.body.data.rows.find((r: { taxPercent: number }) => r.taxPercent === 18);
    const row5 = summary.body.data.rows.find((r: { taxPercent: number }) => r.taxPercent === 5);
    expect(row18.cgstMinor).toBe(rupees(900));
    expect(row18.sgstMinor).toBe(rupees(900));
    expect(row5.cgstMinor).toBe(rupees(50));
    expect(summary.body.data.totalCgstMinor).toBe(rupees(950));
    expect(summary.body.data.totalSgstMinor).toBe(rupees(950));
  });
});
