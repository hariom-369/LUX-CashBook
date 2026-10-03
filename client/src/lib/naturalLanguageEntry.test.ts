import { describe, expect, it } from 'vitest';
import { parseQuickEntry } from './naturalLanguageEntry';

const TODAY = new Date('2026-09-20T12:00:00Z');
const CATEGORIES = [
  { id: 'cat-groceries', name: 'Groceries' },
  { id: 'cat-rent', name: 'Rent' },
  { id: 'cat-salary', name: 'Salary' },
];
const PEOPLE = [
  { id: 'p-ravi', name: 'Ravi' },
  { id: 'p-anita', name: 'Anita Sharma' },
];

describe('parseQuickEntry', () => {
  it('reads an expense amount and category from a plain sentence', () => {
    const result = parseQuickEntry('Paid 250 for groceries', { categories: CATEGORIES, people: PEOPLE, today: TODAY });
    expect(result.type).toBe('expense');
    expect(result.amountMinor).toBe(25000);
    expect(result.categoryId).toBe('cat-groceries');
    expect(result.matched).toBe(true);
  });

  it('detects income from keywords like "received" and "salary"', () => {
    const result = parseQuickEntry('Received 50000 salary', { categories: CATEGORIES, people: PEOPLE, today: TODAY });
    expect(result.type).toBe('income');
    expect(result.amountMinor).toBe(5_000_000);
    expect(result.categoryId).toBe('cat-salary');
  });

  it('understands "yesterday" relative to the given date', () => {
    const result = parseQuickEntry('Paid 100 for lunch yesterday', { categories: CATEGORIES, people: PEOPLE, today: TODAY });
    expect(result.date).toBe('2026-09-19');
  });

  it('defaults to today when no relative date word is present', () => {
    const result = parseQuickEntry('Paid 100 for lunch', { categories: CATEGORIES, people: PEOPLE, today: TODAY });
    expect(result.date).toBe('2026-09-20');
  });

  it('classifies lending and matches a known person after "to"', () => {
    const result = parseQuickEntry('Lent 2000 to Ravi', { categories: CATEGORIES, people: PEOPLE, today: TODAY });
    expect(result.type).toBe('lend');
    expect(result.personId).toBe('p-ravi');
    // Lending is personal, never categorised as an ordinary expense (invariant I5/I6).
    expect(result.categoryId).toBeUndefined();
  });

  it('classifies borrowing and matches a multi-word name after "from"', () => {
    const result = parseQuickEntry('Borrowed 5000 from Anita Sharma', {
      categories: CATEGORIES,
      people: PEOPLE,
      today: TODAY,
    });
    expect(result.type).toBe('borrow');
    expect(result.personId).toBe('p-anita');
  });

  it('classifies an internal transfer', () => {
    const result = parseQuickEntry('Transferred 1500 to savings', { categories: CATEGORIES, people: PEOPLE, today: TODAY });
    expect(result.type).toBe('transfer');
  });

  it('does not mistake a date-like number ("5pm") for the amount', () => {
    const result = parseQuickEntry('Paid 300 for tea at 5pm', { categories: CATEGORIES, people: PEOPLE, today: TODAY });
    expect(result.amountMinor).toBe(30000);
  });

  it('handles a ₹-prefixed amount with comma grouping', () => {
    const result = parseQuickEntry('Spent ₹1,250 on fuel', { categories: CATEGORIES, people: PEOPLE, today: TODAY });
    expect(result.amountMinor).toBe(125000);
  });

  it('reports unmatched when no amount can be found, without throwing', () => {
    const result = parseQuickEntry('Bought groceries', { categories: CATEGORIES, people: PEOPLE, today: TODAY });
    expect(result.amountMinor).toBeNull();
    expect(result.matched).toBe(false);
  });

  it('keeps the original text as the description for the user to review', () => {
    const text = 'Paid 250 for groceries';
    const result = parseQuickEntry(text, { categories: CATEGORIES, people: PEOPLE, today: TODAY });
    expect(result.description).toBe(text);
  });
});

describe('Quick Entry 2.0 (§Phase 2): accounts, transfers, owes, and naming what it could not work out', () => {
  const accounts = [
    { id: 'a-cash', name: 'Cash', type: 'cash' },
    { id: 'a-sbi', name: 'SBI', type: 'bank' },
    { id: 'a-hdfc', name: 'HDFC Savings', type: 'bank' },
    { id: 'a-gpay', name: 'GPay', type: 'upi' },
    { id: 'a-card', name: 'ICICI Amazon', type: 'credit_card' },
  ];
  const ctx = { categories: [], people: [{ id: 'p-rahul', name: 'Rahul Sharma' }], accounts, today: new Date('2026-10-10T12:00:00') };
  const parse = (text: string) => parseQuickEntry(text, ctx);

  it('reads an account named after "from" / "using"', () => {
    expect(parse('Paid 250 for lunch from SBI').accountId).toBe('a-sbi');
    expect(parse('Paid 250 for lunch using GPay').accountId).toBe('a-gpay');
    expect(parse('paid 250 via icici amazon').accountId).toBe('a-card');
  });

  it('reads a kind of account ("using UPI", "by card") when exactly one account fits', () => {
    expect(parse('Paid 250 for lunch using UPI').accountId).toBe('a-gpay');
    expect(parse('Bought shoes 3000 by credit card').accountId).toBe('a-card');
    expect(parse('Paid 100 from cash').accountId).toBe('a-cash');
  });

  it('asks which account instead of guessing when a kind matches several', () => {
    const entry = parse('Paid 5000 rent by bank');
    expect(entry.accountId).toBeUndefined();
    expect(entry.questions).toContainEqual({ field: 'account', candidates: ['a-sbi', 'a-hdfc'] });
  });

  it('asks which account when none is mentioned and there are several', () => {
    const entry = parse('Paid 250 for lunch');
    expect(entry.accountId).toBeUndefined();
    expect(entry.questions).toContainEqual({ field: 'account' });
  });

  it('asks nothing about the account when the user only has one', () => {
    const entry = parseQuickEntry('Paid 250 for lunch', { ...ctx, accounts: [accounts[0]!] });
    expect(entry.questions).toEqual([]);
  });

  it('a longer account name beats a shorter one it contains', () => {
    const entry = parseQuickEntry('Paid 900 from HDFC Savings', { ...ctx, accounts: [...accounts, { id: 'a-hdfc2', name: 'HDFC', type: 'bank' }] });
    expect(entry.accountId).toBe('a-hdfc');
  });

  it('does not match part of a word', () => {
    const entry = parseQuickEntry('Paid 50 for the cashew', { ...ctx, accounts: [{ id: 'a-cash', name: 'Cash', type: 'cash' }, { id: 'x', name: 'Other', type: 'bank' }] });
    expect(entry.accountId).toBeUndefined();
  });

  it('reads both ends of a transfer', () => {
    const entry = parse('Transferred 5000 from SBI to GPay');
    expect(entry.type).toBe('transfer');
    expect(entry.accountId).toBe('a-sbi');
    expect(entry.toAccountId).toBe('a-gpay');
    expect(entry.questions).toEqual([]);
  });

  it('reads a transfer whose "to" comes first in the sentence', () => {
    const entry = parse('Moved cash 2000 to SBI from Cash');
    expect(entry.type).toBe('transfer');
    expect(entry.toAccountId).toBe('a-sbi');
    expect(entry.accountId).toBe('a-cash');
  });

  it('names the missing side of a transfer', () => {
    const entry = parse('Transferred 5000 to GPay');
    expect(entry.toAccountId).toBe('a-gpay');
    expect(entry.accountId).toBeUndefined();
    expect(entry.questions).toContainEqual({ field: 'account' });
    const neither = parse('Transferred 5000');
    expect(neither.questions).toEqual(expect.arrayContaining([{ field: 'account' }, { field: 'toAccount' }]));
  });

  it('reads "Rahul owes me ₹1,200" as money lent to Rahul', () => {
    const entry = parse('Rahul owes me ₹1,200');
    expect(entry.type).toBe('lend');
    expect(entry.amountMinor).toBe(120000);
    expect(entry.personId).toBe('p-rahul');
  });

  it('reads "I owe Rahul 500" as money borrowed from Rahul', () => {
    const entry = parse('I owe Rahul 500');
    expect(entry.type).toBe('borrow');
    expect(entry.amountMinor).toBe(50000);
    expect(entry.personId).toBe('p-rahul');
  });

  it('asks who it was with when the person is not one it knows, and for the amount when there is none', () => {
    const stranger = parse('Meena owes me 400');
    expect(stranger.type).toBe('lend');
    expect(stranger.personId).toBeUndefined();
    expect(stranger.questions).toContainEqual({ field: 'person' });
    const noAmount = parse('Paid for lunch from SBI');
    expect(noAmount.matched).toBe(false);
    expect(noAmount.questions).toContainEqual({ field: 'amount' });
  });

  it('never invents an account when none are supplied (the old behaviour is unchanged)', () => {
    const entry = parseQuickEntry('Paid 250 for lunch using UPI', { categories: [], people: [] });
    expect(entry.accountId).toBeUndefined();
    expect(entry.questions).toEqual([]);
  });

  it('a pathological sentence neither hangs nor throws', () => {
    const started = Date.now();
    expect(() => parse(`${'from '.repeat(400)} ${'a'.repeat(3000)}`)).not.toThrow();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
