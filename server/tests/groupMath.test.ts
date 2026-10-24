import { describe, expect, it } from 'vitest';
import { computeDirectBalances, computeGroupPositions, simplifyDebts, suggestGroupSettlements } from '@khata/shared';

/** The pure group maths in `@khata/shared` (groups.ts), shared by the server and the client's previews. */

describe('simplifyDebts', () => {
  it('settles balances that sum to zero in at most n − 1 payments, moving exactly what is owed', () => {
    const balances = [
      { memberId: 'a', netMinor: 5_000 },
      { memberId: 'b', netMinor: -2_000 },
      { memberId: 'c', netMinor: -2_500 },
      { memberId: 'd', netMinor: -500 },
    ];
    const payments = simplifyDebts(balances);
    expect(payments.length).toBeLessThanOrEqual(balances.length - 1);

    const after = new Map(balances.map((b) => [b.memberId, b.netMinor]));
    for (const p of payments) {
      after.set(p.from!, after.get(p.from!)! + p.amountMinor);
      after.set(p.to!, after.get(p.to!)! - p.amountMinor);
      expect(Number.isSafeInteger(p.amountMinor) && p.amountMinor > 0).toBe(true);
    }
    expect([...after.values()].every((v) => v === 0)).toBe(true);
  });

  it('suggests nothing when everyone is square', () => {
    expect(simplifyDebts([{ memberId: 'a', netMinor: 0 }, { memberId: null, netMinor: 0 }])).toEqual([]);
  });
});

describe('suggestGroupSettlements', () => {
  it('keeps your debts person-to-person and simplifies only among the others', () => {
    // You paid 90 for you, a and b; a paid 60 for a and b.
    const expenses = [
      { paidBy: null, totalAmountMinor: 9_000, shares: [{ memberId: null, amountMinor: 3_000 }, { memberId: 'a', amountMinor: 3_000 }, { memberId: 'b', amountMinor: 3_000 }] },
      { paidBy: 'a', totalAmountMinor: 6_000, shares: [{ memberId: 'a', amountMinor: 3_000 }, { memberId: 'b', amountMinor: 3_000 }] },
    ];
    const positions = computeGroupPositions([null, 'a', 'b'], expenses, []);
    const direct = computeDirectBalances(expenses, []);

    expect(Object.fromEntries(direct)).toEqual({ a: 3_000, b: 3_000 });
    expect(suggestGroupSettlements(positions, direct)).toEqual([
      { from: 'a', to: null, amountMinor: 3_000 },
      { from: 'b', to: null, amountMinor: 3_000 },
      { from: 'b', to: 'a', amountMinor: 3_000 },
    ]);
  });

  it('nets a member\'s payment to you against what they paid for you', () => {
    const expenses = [
      { paidBy: null, totalAmountMinor: 1_000, shares: [{ memberId: 'a', amountMinor: 1_000 }] },
      { paidBy: 'a', totalAmountMinor: 400, shares: [{ memberId: null, amountMinor: 400 }] },
    ];
    const settlements = [{ from: 'a', to: null, amountMinor: 100 }];
    const direct = computeDirectBalances(expenses, settlements);
    expect(direct.get('a')).toBe(500);
    const positions = computeGroupPositions([null, 'a'], expenses, settlements);
    expect(suggestGroupSettlements(positions, direct)).toEqual([{ from: 'a', to: null, amountMinor: 500 }]);
  });
});
