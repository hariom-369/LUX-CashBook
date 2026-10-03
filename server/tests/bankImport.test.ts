import { beforeEach, describe, expect, it } from 'vitest';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Phase 5 (docs/ROADMAP_PHASE5_NOTES.md): bank-statement import with a
 * user-defined column mapping, Indian date/amount parsing, and duplicate
 * classification — distinct from `/import-export`, which only round-trips
 * Khata's own export format.
 */

let user: TestUser;
let bank: string;

beforeEach(async () => {
  user = await createTestUser();
  bank = (await as(user).post('/api/v1/accounts').send({ name: 'Bank', type: 'bank', openingBalanceMinor: rupees(50_000) }).expect(201)).body.data.id;
});

const MAPPING = { date: 'Txn Date', description: 'Narration', debit: 'Withdrawal Amt.', credit: 'Deposit Amt.', reference: 'Ref No' };

function csv(rows: string[]): Buffer {
  const header = 'Txn Date,Narration,Withdrawal Amt.,Deposit Amt.,Ref No';
  return Buffer.from([header, ...rows].join('\n'), 'utf-8');
}

describe('bank statement parsing', () => {
  it('detects headers and sample rows before any mapping is chosen', async () => {
    const file = csv(['01/09/2026,Salary,,"50,000.00",REF1']);
    const res = await as(user).post('/api/v1/bank-import/parse').attach('file', file, 'statement.csv').expect(200);
    expect(res.body.data.headers).toEqual(['Txn Date', 'Narration', 'Withdrawal Amt.', 'Deposit Amt.', 'Ref No']);
    expect(res.body.data.rowCount).toBe(1);
  });

  it('parses dd/mm/yyyy dates and Indian-grouped amounts, and classifies new vs. invalid rows', async () => {
    const file = csv([
      '05/09/2026,Salary credit,,"50,000.00",REF100',
      '06/09/2026,Electricity bill,"1,250.50",,REF101',
      '31/02/2026,Bad date row,100.00,,REF102', // 31 Feb doesn't exist
      'not-a-date,Also bad,,100.00,REF103',
    ]);
    const res = await as(user)
      .post('/api/v1/bank-import/preview')
      .field('accountId', bank)
      .field('dateFormat', 'dd/mm/yyyy')
      .field('mapping', JSON.stringify(MAPPING))
      .attach('file', file, 'statement.csv')
      .expect(200);

    const rows = res.body.data.rows;
    expect(rows[0]).toMatchObject({ status: 'new', amountMinor: rupees(50_000) });
    expect(rows[1]).toMatchObject({ status: 'new', amountMinor: -rupees(1_250.5) });
    expect(rows[2].status).toBe('invalid');
    expect(rows[3].status).toBe('invalid');
    expect(res.body.data.counts).toEqual({ new: 2, duplicate: 0, possible_duplicate: 0, invalid: 2 });
  });

  it('flags an exact amount+reference match as a duplicate, and a same-amount/same-day row without a reference as a possible duplicate', async () => {
    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'income', amountMinor: rupees(5_000), date: '2026-09-10T10:00:00.000Z', accountId: bank, referenceNo: 'REF200', description: 'Already recorded' })
      .expect(201);
    await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(300), date: '2026-09-11T10:00:00.000Z', accountId: bank, description: 'Also already recorded, no reference' })
      .expect(201);

    const file = csv([
      '10/09/2026,Credit,,"5,000.00",REF200', // same amount + same reference → duplicate
      '11/09/2026,Debit,300.00,,REF201', // same amount + same day, different ref → possible duplicate
      '12/09/2026,Genuinely new,,"1,000.00",REF202',
    ]);
    const res = await as(user)
      .post('/api/v1/bank-import/preview')
      .field('accountId', bank)
      .field('dateFormat', 'dd/mm/yyyy')
      .field('mapping', JSON.stringify(MAPPING))
      .attach('file', file, 'statement.csv')
      .expect(200);

    expect(res.body.data.rows.map((r: { status: string }) => r.status)).toEqual(['duplicate', 'possible_duplicate', 'new']);
  });
});

describe('committing a bank import', () => {
  it('posts selected new rows, marks selected matches as reconciled, and skips the rest', async () => {
    const existing = await as(user)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(300), date: '2026-09-11T10:00:00.000Z', accountId: bank, description: 'Matches the statement' })
      .expect(201);

    const file = csv([
      '11/09/2026,Debit,300.00,,REF201', // row 2 — possible duplicate of `existing`
      '12/09/2026,Genuinely new,,"1,000.00",REF202', // row 3 — new
    ]);
    const options = { accountId: bank, dateFormat: 'dd/mm/yyyy', mapping: MAPPING };

    const preview = await as(user)
      .post('/api/v1/bank-import/preview')
      .field('accountId', options.accountId)
      .field('dateFormat', options.dateFormat)
      .field('mapping', JSON.stringify(options.mapping))
      .attach('file', file, 'statement.csv')
      .expect(200);
    const [possibleDup, fresh] = preview.body.data.rows;

    const commit = await as(user)
      .post('/api/v1/bank-import/commit')
      .field('accountId', options.accountId)
      .field('dateFormat', options.dateFormat)
      .field('mapping', JSON.stringify(options.mapping))
      .field('selection', JSON.stringify({ importRowNumbers: [fresh.rowNumber], matchRowNumbers: [possibleDup.rowNumber] }))
      .attach('file', file, 'statement.csv')
      .expect(200);

    expect(commit.body.data).toMatchObject({ imported: 1, matched: 1, skipped: 0 });

    const updated = await as(user).get(`/api/v1/transactions/${existing.body.data.id}`).expect(200);
    expect(updated.body.data.reconciledAt).toBeTruthy();
    expect(updated.body.data.statementRef).toBe('REF201');

    const list = await as(user).get('/api/v1/transactions').expect(200);
    expect(list.body.data.items.some((t: { description: string }) => t.description === 'Genuinely new')).toBe(true);
  });
});

describe('import profiles', () => {
  it('creates, lists, rejects a duplicate name, and deletes a profile', async () => {
    const created = await as(user)
      .post('/api/v1/bank-import/profiles')
      .send({ name: 'HDFC Bank', dateFormat: 'dd/mm/yyyy', mapping: MAPPING, defaultAccountId: bank })
      .expect(201);

    const list = await as(user).get('/api/v1/bank-import/profiles').expect(200);
    expect(list.body.data.map((p: { name: string }) => p.name)).toContain('HDFC Bank');

    const dup = await as(user)
      .post('/api/v1/bank-import/profiles')
      .send({ name: 'HDFC Bank', dateFormat: 'dd/mm/yyyy', mapping: MAPPING })
      .expect(409);
    expect(dup.body.error.code).toBe('DUPLICATE_IMPORT_PROFILE');

    await as(user).delete(`/api/v1/bank-import/profiles/${created.body.data.id}`).expect(200);
    const after = await as(user).get('/api/v1/bank-import/profiles').expect(200);
    expect(after.body.data).toEqual([]);
  });

  it('never leaks another workspace\'s profiles', async () => {
    await as(user).post('/api/v1/bank-import/profiles').send({ name: 'HDFC Bank', dateFormat: 'dd/mm/yyyy', mapping: MAPPING }).expect(201);
    const other = await createTestUser();
    expect((await as(other).get('/api/v1/bank-import/profiles').expect(200)).body.data).toEqual([]);
  });
});
