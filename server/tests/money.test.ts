import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  formatMoneyCompact,
  parseMoney,
  toMajor,
  toMinor,
  isValidAmountMinor,
} from '@khata/shared';

/**
 * Money formatting and parsing.
 *
 * These look like trivial string tests, but they are the boundary where a float
 * could sneak into the ledger, so they are worth being pedantic about.
 */
describe('formatMoney', () => {
  it('uses Indian digit grouping for INR', () => {
    expect(formatMoney(12_500_00)).toBe('₹12,500.00');
    expect(formatMoney(1_25_000_00)).toBe('₹1,25,000.00');
    expect(formatMoney(12_34_567_00)).toBe('₹12,34,567.00');
    expect(formatMoney(1_84_520_00)).toBe('₹1,84,520.00');
  });

  it('uses western grouping for western currencies', () => {
    expect(formatMoney(125_000_00, { currency: 'USD' })).toBe('$125,000.00');
    expect(formatMoney(1_234_567_00, { currency: 'EUR' })).toBe('€1,234,567.00');
  });

  it('renders negative amounts with the sign before the symbol', () => {
    expect(formatMoney(-15_000_00)).toBe('-₹15,000.00');
  });

  it('can drop trailing zero decimals', () => {
    expect(formatMoney(12_500_00, { compactDecimals: true })).toBe('₹12,500');
    expect(formatMoney(12_500_50, { compactDecimals: true })).toBe('₹12,500.50');
  });

  it('masks the value in privacy mode', () => {
    expect(formatMoney(1_84_520_00, { masked: true })).toBe('₹ ••••••');
  });

  it('handles zero-decimal currencies', () => {
    expect(formatMoney(5000, { currency: 'JPY' })).toBe('¥5,000');
  });

  it('never loses a paise to floating point', () => {
    // 0.1 + 0.2 in float is 0.30000000000000004; in minor units it is just 30.
    expect(formatMoney(10 + 20)).toBe('₹0.30');
    // 99,99,99,999.99 — just under 100 crore, well inside exact-integer range.
    expect(formatMoney(99_99_99_999_99)).toBe('₹99,99,99,999.99');
    expect(formatMoney(9_99_99_99_999_99)).toBe('₹9,99,99,99,999.99');
  });
});

describe('formatMoneyCompact', () => {
  it('uses lakh and crore for Indian grouping', () => {
    expect(formatMoneyCompact(1_25_000_00)).toBe('₹1.3L');
    expect(formatMoneyCompact(2_50_00_000_00)).toBe('₹2.5Cr');
    expect(formatMoneyCompact(12_500_00)).toBe('₹12.5K');
  });

  it('uses K/M/B for western grouping', () => {
    expect(formatMoneyCompact(1_500_000_00, 'USD')).toBe('$1.5M');
  });
});

describe('parseMoney', () => {
  it('accepts what people actually type', () => {
    expect(parseMoney('1,25,000')).toBe(1_25_000_00);
    expect(parseMoney('₹ 1234')).toBe(1234_00);
    expect(parseMoney('1234.5')).toBe(1234_50);
    expect(parseMoney('1234.56')).toBe(1234_56);
    expect(parseMoney('  500  ')).toBe(500_00);
  });

  it('understands shorthand', () => {
    expect(parseMoney('5k')).toBe(5_000_00);
    expect(parseMoney('1.5L')).toBe(1_50_000_00);
    expect(parseMoney('2cr')).toBe(2_00_00_000_00);
  });

  it('truncates rather than rounds beyond the currency precision', () => {
    // A user typing a third decimal in rupees means paise; we take the paise.
    expect(parseMoney('10.999')).toBe(10_99);
  });

  it('rejects anything that is not an amount', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('12.34.56')).toBeNull();
    expect(parseMoney('--5')).toBeNull();
  });

  it('rejects absurd values rather than overflowing', () => {
    expect(parseMoney('999999999999999999')).toBeNull();
  });
});

describe('minor/major conversion', () => {
  it('round-trips exactly', () => {
    for (const rupees of [0, 1, 99.99, 1234.56, 125000, 9999999.99]) {
      expect(toMajor(toMinor(rupees))).toBeCloseTo(rupees, 2);
    }
  });

  it('rounds half away from zero symmetrically', () => {
    expect(toMinor(0.005)).toBe(1);
    expect(toMinor(-0.005)).toBe(-1);
  });
});

describe('isValidAmountMinor', () => {
  it('accepts whole numbers inside the supported range', () => {
    expect(isValidAmountMinor(0)).toBe(true);
    expect(isValidAmountMinor(-12_500)).toBe(true);
  });

  it('rejects fractions, NaN and out-of-range values', () => {
    expect(isValidAmountMinor(10.5)).toBe(false);
    expect(isValidAmountMinor(Number.NaN)).toBe(false);
    expect(isValidAmountMinor(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidAmountMinor(1e20)).toBe(false);
    expect(isValidAmountMinor('100' as unknown as number)).toBe(false);
  });
});
