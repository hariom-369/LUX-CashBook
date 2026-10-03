import { beforeEach, describe, expect, it } from 'vitest';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Hostile CSV headers and cells (docs/SECURITY.md, dependency advisories). Written when csv-parse moved to
 * 7.x (prototype-replacement advisory): the upload endpoints must keep working, must never pollute
 * `Object.prototype`, and must still neutralise spreadsheet formulas.
 */

let user: TestUser;
let bank: string;

beforeEach(async () => {
  user = await createTestUser();
  bank = (await as(user).post('/api/v1/accounts').send({ name: 'Bank', type: 'bank', openingBalanceMinor: rupees(10_000) }).expect(201)).body.data.id;
});

const polluted = () => ({}) as Record<string, unknown>;

describe('bank statement upload with hostile headers', () => {
  it.each(['__proto__', 'constructor', 'prototype', '__proto__.polluted', 'toString'])('a column called %s is just a name', async (name) => {
    const file = Buffer.from(`Txn Date,${name},Amt\n05/09/2026,hello,100\n`, 'utf-8');
    const res = await as(user).post('/api/v1/bank-import/parse').attach('file', file, 'statement.csv').expect(200);
    expect(res.body.data.headers).toContain(name);
    expect(polluted().polluted).toBeUndefined();
    expect(polluted().hello).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it('previews a statement whose description column is named __proto__', async () => {
    const file = Buffer.from('Txn Date,__proto__,Debit\n05/09/2026,"=HYPERLINK(""http://evil"")",100.00\n', 'utf-8');
    const res = await as(user)
      .post('/api/v1/bank-import/preview')
      .field('accountId', bank)
      .field('dateFormat', 'dd/mm/yyyy')
      .field('mapping', JSON.stringify({ date: 'Txn Date', description: '__proto__', debit: 'Debit' }))
      .attach('file', file, 'statement.csv')
      .expect(200);
    expect(res.body.data.rows[0]).toMatchObject({ status: 'new', amountMinor: -rupees(100) });
    expect(polluted().description).toBeUndefined();
  });
});

describe('Khata CSV import with hostile headers', () => {
  it('rejects or ignores unknown columns without touching the prototype', async () => {
    const file = Buffer.from('Date,Type,Amount,Account,Category,Description,__proto__\n2026-10-01,expense,10,Cash,,Tea,x\n', 'utf-8');
    const res = await as(user).post('/api/v1/import-export/preview').attach('file', file, 'khata.csv');
    expect([200, 400, 422]).toContain(res.status);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(polluted().x).toBeUndefined();
  });
});
