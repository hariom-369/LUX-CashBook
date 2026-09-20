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
