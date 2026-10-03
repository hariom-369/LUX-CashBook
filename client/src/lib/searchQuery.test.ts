import { describe, expect, it } from 'vitest';
import { parseSearchQuery, readSearchLink, searchToUrl, toMinor } from './searchQuery';

const accounts = [
  { id: 'a-cash', name: 'Cash', type: 'cash' },
  { id: 'a-sbi', name: 'SBI Savings', type: 'bank' },
  { id: 'a-hdfc', name: 'HDFC', type: 'bank' },
  { id: 'a-gpay', name: 'GPay', type: 'upi' },
];

describe('toMinor (integer paise, never floating point)', () => {
  it('reads plain, comma-grouped and decimal amounts', () => {
    expect(toMinor('5000')).toBe(500000);
    expect(toMinor('5,000')).toBe(500000);
    expect(toMinor('1,20,000')).toBe(12000000);
    expect(toMinor('199.5')).toBe(19950);
    expect(toMinor('0.07')).toBe(7);
  });

  it('applies k / lakh / crore without rounding error', () => {
    expect(toMinor('5', 'k')).toBe(500000);
    expect(toMinor('1.5', 'k')).toBe(150000);
    expect(toMinor('2', 'lakh')).toBe(20000000);
    expect(toMinor('1.1', 'lakh')).toBe(11000000);
    expect(toMinor('1', 'cr')).toBe(1000000000);
  });

  it('refuses what is not a safe amount', () => {
    expect(toMinor('1.234')).toBeNull();
    expect(toMinor('abc')).toBeNull();
    expect(toMinor('9'.repeat(30))).toBeNull();
  });
});

describe('parseSearchQuery (§Phase 2 structured search)', () => {
  it('reads "above ₹5000" as a minimum and leaves no text', () => {
    const q = parseSearchQuery('above ₹5000', accounts);
    expect(q).toMatchObject({ structured: true, minAmountMinor: 500000, text: '' });
    expect(q.maxAmountMinor).toBeUndefined();
  });

  it('reads the other ways of saying more and less', () => {
    expect(parseSearchQuery('over Rs. 1,200').minAmountMinor).toBe(120000);
    expect(parseSearchQuery('more than 2k').minAmountMinor).toBe(200000);
    expect(parseSearchQuery('> 300').minAmountMinor).toBe(30000);
    expect(parseSearchQuery('below 200').maxAmountMinor).toBe(20000);
    expect(parseSearchQuery('under ₹1.5 lakh').maxAmountMinor).toBe(15000000);
    expect(parseSearchQuery('< 50').maxAmountMinor).toBe(5000);
  });

  it('reads a period and keeps the rest as the text to search for', () => {
    expect(parseSearchQuery('Zomato last 3 months', accounts)).toMatchObject({ structured: true, text: 'Zomato', range: 'last_3_months' });
    expect(parseSearchQuery('petrol this month')).toMatchObject({ text: 'petrol', range: 'this_month' });
    expect(parseSearchQuery('rent last year')).toMatchObject({ text: 'rent', range: 'last_year' });
  });

  it('reads "UPI expenses" as expenses on the one UPI account', () => {
    const q = parseSearchQuery('UPI expenses', accounts);
    expect(q).toMatchObject({ structured: true, types: ['expense'], accountId: 'a-gpay', text: '' });
  });

  it('reads an account by name', () => {
    expect(parseSearchQuery('HDFC expenses above 500', accounts)).toMatchObject({ accountId: 'a-hdfc', types: ['expense'], minAmountMinor: 50000, text: '' });
    expect(parseSearchQuery('SBI Savings income', accounts).accountId).toBe('a-sbi');
  });

  it('does not guess between several accounts of one kind', () => {
    const q = parseSearchQuery('bank expenses', accounts);
    expect(q.accountId).toBeUndefined();
    expect(q.types).toEqual(['expense']);
    expect(q.text).toBe('bank');
  });

  it('combines everything it can read', () => {
    expect(parseSearchQuery('swiggy upi expenses above ₹300 last 30 days', accounts)).toMatchObject({
      text: 'swiggy', accountId: 'a-gpay', types: ['expense'], minAmountMinor: 30000, range: 'last_30_days',
    });
  });

  it('leaves an ordinary search alone, including a bare account word', () => {
    expect(parseSearchQuery('Zomato', accounts)).toEqual({ text: 'Zomato', structured: false });
    expect(parseSearchQuery('cash withdrawal', accounts)).toEqual({ text: 'cash withdrawal', structured: false });
    expect(parseSearchQuery('invoice 5000', accounts).structured).toBe(false);
  });

  it('does not mistake a word that merely contains a filter word', () => {
    expect(parseSearchQuery('expensive dinner', accounts).structured).toBe(false);
    expect(parseSearchQuery('todays special', accounts).structured).toBe(false);
  });

  it('ignores an amount it cannot read safely', () => {
    expect(parseSearchQuery(`above ${'9'.repeat(30)}`).structured).toBe(false);
  });

  it('treats an account name as plain text, never as a pattern', () => {
    const odd = [{ id: 'x', name: 'A+B (main)', type: 'bank' }];
    expect(() => parseSearchQuery('A+B (main) expenses', odd)).not.toThrow();
    expect(parseSearchQuery('A+B (main) expenses', odd).accountId).toBe('x');
    expect(parseSearchQuery('AAB expenses', odd).accountId).toBeUndefined();
  });

  it('is fast on a hostile query', () => {
    const started = Date.now();
    parseSearchQuery(`${'above 1'.repeat(300)} ${'9,'.repeat(2000)}`, accounts);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('searchToUrl', () => {
  it('builds the transaction-list link from a reading', () => {
    expect(searchToUrl(parseSearchQuery('Zomato last 3 months', accounts))).toBe('/transactions?q=Zomato&range=last_3_months');
    expect(searchToUrl(parseSearchQuery('UPI expenses above 500', accounts))).toBe('/transactions?types=expense&account=a-gpay&min=50000');
  });

  it('encodes the text safely', () => {
    expect(searchToUrl({ text: 'a&b=c', structured: true, range: 'this_year' })).toBe('/transactions?q=a%26b%3Dc&range=this_year');
  });
});

describe('readSearchLink', () => {
  const read = (s: string) => readSearchLink(new URLSearchParams(s));

  it('reads back what searchToUrl wrote', () => {
    const search = parseSearchQuery('swiggy upi expenses above ₹300 last 30 days', accounts);
    const link = read(searchToUrl(search).split('?')[1]!);
    expect(link).toEqual({ q: 'swiggy', range: 'last_30_days', types: ['expense'], accountId: 'a-gpay', minAmountMinor: 30000, maxAmountMinor: undefined, hasFilters: true });
  });

  it('is a plain search when only q is present', () => {
    expect(read('q=Zomato')).toMatchObject({ q: 'Zomato', hasFilters: false });
    expect(read('')).toMatchObject({ q: '', hasFilters: false });
  });

  it('accepts only values the list offers, ignoring the rest', () => {
    const link = read('range=century&types=expense,bogus,__proto__&account=../etc&min=-5&max=1e9&q=' + 'x'.repeat(500));
    expect(link.range).toBeUndefined();
    expect(link.types).toEqual(['expense']);
    expect(link.accountId).toBeUndefined();
    expect(link.minAmountMinor).toBeUndefined();
    expect(link.maxAmountMinor).toBeUndefined();
    expect(link.q).toHaveLength(120);
  });
});
