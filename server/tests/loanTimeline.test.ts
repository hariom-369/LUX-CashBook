import { beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';
import { syncLoanReminders } from '../src/modules/reminders/reminder.service.js';

/**
 * Phase 4 (docs/ROADMAP_PHASE4_NOTES.md): a loan's own timeline, separate from
 * the person's flat running ledger, plus an optional installment schedule
 * whose "paid" status is always derived from the loan's real `settledMinor` —
 * never a second source of truth.
 */

let user: TestUser;
let bank: string;
let rahul: string;

function scopeOf(u: TestUser) {
  return {
    userId: Types.ObjectId.createFromHexString(u.userId),
    workspaceId: Types.ObjectId.createFromHexString(u.workspaceId),
    currency: 'INR',
    mode: 'personal' as const,
    role: 'owner' as const,
    hiddenAccountIds: [],
  };
}

const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  user = await createTestUser();
  bank = (await as(user).post('/api/v1/accounts').send({ name: 'Bank', type: 'bank', openingBalanceMinor: rupees(50_000) }).expect(201)).body.data.id;
  rahul = (await as(user).post('/api/v1/people').send({ name: 'Rahul' }).expect(201)).body.data.id;
});

describe('per-loan timeline', () => {
  it('breaks a person\'s loans into their own repayment threads', async () => {
    await as(user).post(`/api/v1/people/${rahul}/lend`).send({ amountMinor: rupees(10_000), accountId: bank }).expect(201);
    await as(user).post(`/api/v1/people/${rahul}/repay`).send({ amountMinor: rupees(2_000), accountId: bank }).expect(201);
    await as(user).post(`/api/v1/people/${rahul}/repay`).send({ amountMinor: rupees(3_000), accountId: bank }).expect(201);

    const timeline = await as(user).get(`/api/v1/people/${rahul}/timeline`).expect(200);
    expect(timeline.body.data).toHaveLength(1);
    const entry = timeline.body.data[0];
    expect(entry.loan.amountMinor).toBe(rupees(10_000));
    expect(entry.repayments).toHaveLength(2);
    expect(entry.repayments.map((r: { amountMinor: number }) => r.amountMinor)).toEqual([rupees(2_000), rupees(3_000)]);
    expect(entry.remainingMinor).toBe(rupees(5_000));
    expect(entry.installmentPlan).toBeUndefined();
  });

  it('never leaks another user\'s loans', async () => {
    await as(user).post(`/api/v1/people/${rahul}/lend`).send({ amountMinor: rupees(10_000), accountId: bank }).expect(201);
    const other = await createTestUser();
    await as(other).get(`/api/v1/people/${rahul}/timeline`).expect(404);
  });
});

describe('installment schedules', () => {
  let loanId: string;

  beforeEach(async () => {
    const lent = await as(user).post(`/api/v1/people/${rahul}/lend`).send({ amountMinor: rupees(10_000), accountId: bank }).expect(201);
    loanId = lent.body.data.id;
  });

  it('creates a schedule, derives paid status from real repayments, and rejects a total over the loan amount', async () => {
    await as(user)
      .put(`/api/v1/loans/${loanId}/installments`)
      .send({
        installments: [
          { dueDate: new Date(Date.now() - DAY).toISOString(), amountMinor: rupees(5_000) },
          { dueDate: new Date(Date.now() + 30 * DAY).toISOString(), amountMinor: rupees(5_000) },
        ],
      })
      .expect(200);

    // Nothing repaid yet — both installments are still owed, and the past one is overdue.
    let plan = (await as(user).get(`/api/v1/loans/${loanId}/installments`).expect(200)).body.data;
    expect(plan.installments.map((i: { status: string }) => i.status)).toEqual(['overdue', 'upcoming']);

    // A real repayment of exactly the first installment's amount — the plan
    // never stores this itself, it reads it back off the loan.
    await as(user).post(`/api/v1/people/${rahul}/repay`).send({ amountMinor: rupees(5_000), accountId: bank }).expect(201);

    plan = (await as(user).get(`/api/v1/loans/${loanId}/installments`).expect(200)).body.data;
    expect(plan.installments.map((i: { status: string }) => i.status)).toEqual(['paid', 'upcoming']);

    await as(user)
      .put(`/api/v1/loans/${loanId}/installments`)
      .send({ installments: [{ dueDate: new Date().toISOString(), amountMinor: rupees(20_000) }] })
      .expect(400);
  });

  it('removes a schedule', async () => {
    await as(user)
      .put(`/api/v1/loans/${loanId}/installments`)
      .send({ installments: [{ dueDate: new Date().toISOString(), amountMinor: rupees(10_000) }] })
      .expect(200);

    await as(user).delete(`/api/v1/loans/${loanId}/installments`).expect(200);
    expect((await as(user).get(`/api/v1/loans/${loanId}/installments`).expect(200)).body.data).toBeNull();
  });

  it('refuses installments on another workspace\'s loan', async () => {
    const other = await createTestUser();
    await as(other)
      .put(`/api/v1/loans/${loanId}/installments`)
      .send({ installments: [{ dueDate: new Date().toISOString(), amountMinor: rupees(1_000) }] })
      .expect(404);
  });

  it('raises one reminder per unpaid installment instead of a single loan-level one', async () => {
    await as(user)
      .put(`/api/v1/loans/${loanId}/installments`)
      .send({
        installments: [
          { dueDate: new Date(Date.now() + DAY).toISOString(), amountMinor: rupees(5_000) },
          { dueDate: new Date(Date.now() + 15 * DAY).toISOString(), amountMinor: rupees(5_000) },
        ],
      })
      .expect(200);

    await syncLoanReminders(scopeOf(user));

    const reminders = await as(user).get('/api/v1/reminders').expect(200);
    const installmentReminders = reminders.body.data.filter((r: { type: string }) => r.type === 'loan_due');
    expect(installmentReminders).toHaveLength(2);

    // Pay off the first installment and re-sync — it should drop out.
    await as(user).post(`/api/v1/people/${rahul}/repay`).send({ amountMinor: rupees(5_000), accountId: bank }).expect(201);
    await syncLoanReminders(scopeOf(user));

    const after = await as(user).get('/api/v1/reminders').expect(200);
    expect(after.body.data.filter((r: { type: string }) => r.type === 'loan_due')).toHaveLength(1);
  });
});
