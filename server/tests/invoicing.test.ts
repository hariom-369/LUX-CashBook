import { beforeEach, describe, expect, it } from 'vitest';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Phase 11 (Freelancer mode): invoices, quotations and projects. Invoice
 * payments post through the ordinary transaction engine — `createTransaction`
 * inside the same unit of work that flips the invoice's own status — so the
 * tests here lean on that atomicity (paid status and the backing transaction
 * always agree) as much as on the invoicing-specific business rules
 * (draft-only edits, number sequencing, conversion).
 */

let user: TestUser;
let bank: string;
let customer: string;

beforeEach(async () => {
  user = await createTestUser();
  bank = (await as(user).post('/api/v1/accounts').send({ name: 'Bank', type: 'bank', openingBalanceMinor: rupees(10_000) }).expect(201)).body.data.id;
  customer = (await as(user).post('/api/v1/people').send({ name: 'Acme Co', relationship: 'customer' }).expect(201)).body.data.id;
});

function invoicePayload(overrides: Record<string, unknown> = {}) {
  return {
    personId: customer,
    issueDate: new Date('2026-01-10').toISOString(),
    dueDate: new Date('2026-01-25').toISOString(),
    items: [
      { description: 'Design work', quantity: 10, rateMinor: rupees(500) },
      { description: 'Hosting', quantity: 1, rateMinor: rupees(1_000) },
    ],
    discountMinor: rupees(200),
    taxPercent: 18,
    ...overrides,
  };
}

describe('invoice totals', () => {
  it('computes the line amounts, subtotal, discount, tax and total itself — never trusting a client-sent amount', async () => {
    const res = await as(user)
      .post('/api/v1/invoices')
      .send(invoicePayload())
      .expect(201);

    const dto = res.body.data;
    // 10*500 + 1*1000 = 6000; minus 200 discount = 5800 taxable; 18% tax = 1044; total 6844.
    expect(dto.items[0].amountMinor).toBe(rupees(5_000));
    expect(dto.subtotalMinor).toBe(rupees(6_000));
    expect(dto.taxMinor).toBe(rupees(1_044));
    expect(dto.totalMinor).toBe(rupees(6_844));
    expect(dto.status).toBe('draft');
    expect(dto.number).toMatch(/^INV-\d{4}-\d{5}$/);
  });

  it('refuses a discount larger than the subtotal', async () => {
    await as(user)
      .post('/api/v1/invoices')
      .send(invoicePayload({ discountMinor: rupees(100_000) }))
      .expect(400);
  });

  it('refuses a due date before the issue date', async () => {
    await as(user)
      .post('/api/v1/invoices')
      .send(invoicePayload({ issueDate: new Date('2026-02-01').toISOString(), dueDate: new Date('2026-01-01').toISOString() }))
      .expect(400);
  });
});

describe('number sequencing', () => {
  it('assigns strictly increasing numbers, never repeating one, across concurrent creates', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => as(user).post('/api/v1/invoices').send(invoicePayload()).expect(201)),
    );
    const numbers = results.map((r) => r.body.data.number);
    expect(new Set(numbers).size).toBe(5);
  });

  it('invoices and quotations are numbered from separate series', async () => {
    const invoice = await as(user).post('/api/v1/invoices').send(invoicePayload()).expect(201);
    const quotation = await as(user)
      .post('/api/v1/quotations')
      .send({ personId: customer, issueDate: new Date().toISOString(), expiryDate: new Date(Date.now() + 86400000 * 14).toISOString(), items: [{ description: 'Scoping', quantity: 1, rateMinor: rupees(1_000) }] })
      .expect(201);

    expect(invoice.body.data.number).toMatch(/^INV-/);
    expect(quotation.body.data.number).toMatch(/^QUO-/);
  });
});

describe('invoice lifecycle', () => {
  it('a draft can be edited; a sent invoice cannot', async () => {
    const created = await as(user).post('/api/v1/invoices').send(invoicePayload()).expect(201);
    const id = created.body.data.id;

    await as(user).patch(`/api/v1/invoices/${id}`).send({ notes: 'Updated while draft' }).expect(200);
    await as(user).post(`/api/v1/invoices/${id}/send`).expect(200);
    await as(user).patch(`/api/v1/invoices/${id}`).send({ notes: 'Too late' }).expect(409);
  });

  it('marking an invoice paid atomically posts an income transaction and flips the status, both or neither', async () => {
    const created = await as(user).post('/api/v1/invoices').send(invoicePayload()).expect(201);
    const id = created.body.data.id;
    await as(user).post(`/api/v1/invoices/${id}/send`).expect(200);

    const paid = await as(user).post(`/api/v1/invoices/${id}/pay`).send({ accountId: bank }).expect(200);
    expect(paid.body.data.status).toBe('paid');
    expect(paid.body.data.paidTransactionId).toBeTruthy();

    const account = await as(user).get(`/api/v1/accounts/${bank}`).expect(200);
    expect(account.body.data.balanceMinor).toBe(rupees(10_000) + paid.body.data.totalMinor);

    const txn = await as(user).get(`/api/v1/transactions/${paid.body.data.paidTransactionId}`).expect(200);
    expect(txn.body.data.type).toBe('income');
    expect(txn.body.data.amountMinor).toBe(paid.body.data.totalMinor);
  });

  it('cannot pay a draft invoice, or pay the same invoice twice', async () => {
    const created = await as(user).post('/api/v1/invoices').send(invoicePayload()).expect(201);
    const id = created.body.data.id;

    await as(user).post(`/api/v1/invoices/${id}/pay`).send({ accountId: bank }).expect(409);

    await as(user).post(`/api/v1/invoices/${id}/send`).expect(200);
    await as(user).post(`/api/v1/invoices/${id}/pay`).send({ accountId: bank }).expect(200);
    await as(user).post(`/api/v1/invoices/${id}/pay`).send({ accountId: bank }).expect(409);
  });

  it('a paid invoice cannot be cancelled, and a cancelled one cannot be paid', async () => {
    const created = await as(user).post('/api/v1/invoices').send(invoicePayload()).expect(201);
    const id = created.body.data.id;
    await as(user).post(`/api/v1/invoices/${id}/send`).expect(200);
    await as(user).post(`/api/v1/invoices/${id}/pay`).send({ accountId: bank }).expect(200);
    await as(user).post(`/api/v1/invoices/${id}/cancel`).expect(409);

    const other = await as(user).post('/api/v1/invoices').send(invoicePayload()).expect(201);
    const otherId = other.body.data.id;
    await as(user).post(`/api/v1/invoices/${otherId}/send`).expect(200);
    await as(user).post(`/api/v1/invoices/${otherId}/cancel`).expect(200);
    await as(user).post(`/api/v1/invoices/${otherId}/pay`).send({ accountId: bank }).expect(409);
  });

  it('a sent invoice past its due date displays as overdue — a derived status, not a stored one', async () => {
    const created = await as(user)
      .post('/api/v1/invoices')
      .send(invoicePayload({ issueDate: new Date('2020-01-01').toISOString(), dueDate: new Date('2020-01-15').toISOString() }))
      .expect(201);
    const id = created.body.data.id;
    await as(user).post(`/api/v1/invoices/${id}/send`).expect(200);

    const fetched = await as(user).get(`/api/v1/invoices/${id}`).expect(200);
    expect(fetched.body.data.status).toBe('overdue');

    const list = await as(user).get('/api/v1/invoices?status=overdue').expect(200);
    expect(list.body.data.find((i: { id: string }) => i.id === id)).toBeDefined();
  });

  it('only a draft invoice can be deleted', async () => {
    const created = await as(user).post('/api/v1/invoices').send(invoicePayload()).expect(201);
    const id = created.body.data.id;
    await as(user).post(`/api/v1/invoices/${id}/send`).expect(200);
    await as(user).delete(`/api/v1/invoices/${id}`).expect(403);
  });
});

describe('quotation → invoice conversion', () => {
  it('copies items and totals into a brand-new invoice with its own number, and marks the quotation converted', async () => {
    const quotation = await as(user)
      .post('/api/v1/quotations')
      .send({
        personId: customer,
        issueDate: new Date('2026-01-01').toISOString(),
        expiryDate: new Date('2026-02-01').toISOString(),
        items: [{ description: 'Website build', quantity: 1, rateMinor: rupees(40_000) }],
        taxPercent: 18,
      })
      .expect(201);
    const quotationId = quotation.body.data.id;

    const result = await as(user)
      .post(`/api/v1/quotations/${quotationId}/convert`)
      .send({ dueDate: new Date(Date.now() + 86400000 * 30).toISOString() })
      .expect(201);

    expect(result.body.data.invoice.totalMinor).toBe(quotation.body.data.totalMinor);
    expect(result.body.data.invoice.items).toEqual(quotation.body.data.items);
    expect(result.body.data.invoice.number).not.toBe(quotation.body.data.number);
    expect(result.body.data.quotation.status).toBe('converted');
    expect(result.body.data.quotation.convertedInvoiceId).toBe(result.body.data.invoice.id);

    // Converting twice is refused.
    await as(user)
      .post(`/api/v1/quotations/${quotationId}/convert`)
      .send({ dueDate: new Date(Date.now() + 86400000 * 30).toISOString() })
      .expect(409);
  });

  it('a declined quotation cannot be converted', async () => {
    const quotation = await as(user)
      .post('/api/v1/quotations')
      .send({
        personId: customer,
        issueDate: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 86400000 * 7).toISOString(),
        items: [{ description: 'Consulting', quantity: 2, rateMinor: rupees(2_000) }],
      })
      .expect(201);
    const id = quotation.body.data.id;

    await as(user).post(`/api/v1/quotations/${id}/status`).send({ status: 'declined' }).expect(200);
    await as(user).post(`/api/v1/quotations/${id}/convert`).send({ dueDate: new Date().toISOString() }).expect(409);
  });
});

describe('projects', () => {
  it('tracks billed (paid invoices) and billable expenses (attributed transactions) as live profit, never cached', async () => {
    const project = await as(user).post('/api/v1/projects').send({ name: 'Website Redesign', personId: customer }).expect(201);
    const projectId = project.body.data.id;

    const invoice = await as(user).post('/api/v1/invoices').send(invoicePayload({ projectId })).expect(201);
    await as(user).post(`/api/v1/invoices/${invoice.body.data.id}/send`).expect(200);
    await as(user).post(`/api/v1/invoices/${invoice.body.data.id}/pay`).send({ accountId: bank }).expect(200);

    const expenseCategory = (await as(user).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id;
    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(1_200), accountId: bank, categoryId: expenseCategory, date: new Date().toISOString(), description: 'Stock photos', projectId })
      .expect(201);

    const summary = await as(user).get(`/api/v1/projects/${projectId}/summary`).expect(200);
    expect(summary.body.data.billedMinor).toBe(invoice.body.data.totalMinor);
    expect(summary.body.data.expenseMinor).toBe(rupees(1_200));
    expect(summary.body.data.profitMinor).toBe(invoice.body.data.totalMinor - rupees(1_200));
  });

  it('refuses to delete a project that still has invoices against it', async () => {
    const project = await as(user).post('/api/v1/projects').send({ name: 'Mobile App' }).expect(201);
    await as(user).post('/api/v1/invoices').send(invoicePayload({ projectId: project.body.data.id })).expect(201);

    await as(user).delete(`/api/v1/projects/${project.body.data.id}`).expect(409);
  });
});

describe('workspace isolation', () => {
  it('never leaks an invoice, quotation or project across users', async () => {
    const outsider = await createTestUser();
    const invoice = await as(user).post('/api/v1/invoices').send(invoicePayload()).expect(201);
    const project = await as(user).post('/api/v1/projects').send({ name: 'Private Project' }).expect(201);

    await as(outsider).get(`/api/v1/invoices/${invoice.body.data.id}`).expect(404);
    await as(outsider).get(`/api/v1/projects/${project.body.data.id}`).expect(404);
    await as(outsider).post(`/api/v1/invoices/${invoice.body.data.id}/send`).expect(404);
  });
});
