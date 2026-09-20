import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from '@khata/shared';
import { cn } from './cn';

/**
 * The client re-uses the shared money module verified on the server; these tests
 * confirm the client build actually resolves and exercises it correctly (the
 * `@khata/shared` path alias, Vite's bundling of it) rather than re-testing the
 * arithmetic itself.
 */
describe('shared money module from the client bundle', () => {
  it('formats and parses consistently through the client path alias', () => {
    // ₹1,25,000.00 in minor units (paise).
    expect(formatMoney(125_000_00)).toBe('₹1,25,000.00');
    expect(parseMoney('1,25,000')).toBe(125_000_00);
  });
});

describe('cn', () => {
  it('merges conflicting Tailwind utilities, letting the later one win', () => {
    expect(cn('px-4', 'px-6')).toBe('px-6');
  });

  it('drops falsy values', () => {
    expect(cn('a', false && 'b', undefined, null, 'c')).toBe('a c');
  });
});
