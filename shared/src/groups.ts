/**
 * Group expense maths (§Phase 8 follow-up — any member can pay).
 *
 * Pure functions over a group's own records, shared by the server (which stores
 * and validates) and the client (which previews). Every figure is an integer in
 * minor units; nothing here can create or lose a paisa.
 *
 * Member ids are `string | null`, where `null` is always "you" — the owner of the
 * books this group lives in.
 *
 * Settlement suggestions are deliberately two-part:
 *  - Between you and each member the suggestion is the direct, person-to-person
 *    amount. Those amounts are exactly what your People ledger shows for that
 *    person, so recording one can never move a debt onto someone it doesn't
 *    belong to in your own books.
 *  - Among everyone else, debts are simplified to as few payments as possible
 *    (largest debtor pays largest creditor, repeated). None of that touches your
 *    books, so the group is free to net it however settles fastest.
 */

export type GroupMemberId = string | null;

export interface GroupLedgerExpense {
  paidBy: GroupMemberId;
  totalAmountMinor: number;
  shares: Array<{ memberId: GroupMemberId; amountMinor: number }>;
}

export interface GroupLedgerSettlement {
  from: GroupMemberId;
  to: GroupMemberId;
  amountMinor: number;
}

export interface GroupMemberPosition {
  memberId: GroupMemberId;
  /** What this member paid for group expenses. */
  paidMinor: number;
  /** Their fair share: the sum of their part of every expense. */
  shareMinor: number;
  /** Settlement money they handed over / received. */
  sentMinor: number;
  receivedMinor: number;
  /** Positive: the group owes them. Negative: they owe the group. */
  netMinor: number;
}

export interface GroupSettlementSuggestion {
  from: GroupMemberId;
  to: GroupMemberId;
  amountMinor: number;
}

const keyOf = (id: GroupMemberId) => id ?? '';

/** Every member's paid / share / net position. `memberIds` should include `null` (you). */
export function computeGroupPositions(
  memberIds: GroupMemberId[],
  expenses: GroupLedgerExpense[],
  settlements: GroupLedgerSettlement[],
): GroupMemberPosition[] {
  const positions = new Map<string, GroupMemberPosition>();
  const at = (id: GroupMemberId) => {
    let p = positions.get(keyOf(id));
    if (!p) {
      p = { memberId: id, paidMinor: 0, shareMinor: 0, sentMinor: 0, receivedMinor: 0, netMinor: 0 };
      positions.set(keyOf(id), p);
    }
    return p;
  };
  for (const id of memberIds) at(id);

  for (const e of expenses) {
    at(e.paidBy).paidMinor += e.totalAmountMinor;
    for (const s of e.shares) at(s.memberId).shareMinor += s.amountMinor;
  }
  for (const s of settlements) {
    at(s.from).sentMinor += s.amountMinor;
    at(s.to).receivedMinor += s.amountMinor;
  }
  for (const p of positions.values()) {
    p.netMinor = p.paidMinor - p.shareMinor + p.sentMinor - p.receivedMinor;
  }
  return [...positions.values()];
}

/**
 * The direct balance between you and each member: positive means they owe you.
 * Built only from expenses one of you paid with the other sharing, and payments
 * between the two of you — the same events your own books record for that person.
 */
export function computeDirectBalances(
  expenses: GroupLedgerExpense[],
  settlements: GroupLedgerSettlement[],
): Map<string, number> {
  const owed = new Map<string, number>();
  const add = (personId: string, delta: number) => owed.set(personId, (owed.get(personId) ?? 0) + delta);

  for (const e of expenses) {
    if (e.paidBy === null) {
      for (const s of e.shares) if (s.memberId !== null) add(s.memberId, s.amountMinor);
    } else {
      const mine = e.shares.find((s) => s.memberId === null)?.amountMinor ?? 0;
      if (mine > 0) add(e.paidBy, -mine);
    }
  }
  for (const s of settlements) {
    if (s.from !== null && s.to === null) add(s.from, -s.amountMinor);
    else if (s.from === null && s.to !== null) add(s.to, s.amountMinor);
  }
  return owed;
}

/** Fewest-payments settlement of balances that sum to zero (greedy, deterministic). */
export function simplifyDebts(balances: Array<{ memberId: GroupMemberId; netMinor: number }>): GroupSettlementSuggestion[] {
  const byAmount = (a: { amount: number; id: string }, b: { amount: number; id: string }) => b.amount - a.amount || a.id.localeCompare(b.id);
  const creditors = balances.filter((b) => b.netMinor > 0).map((b) => ({ memberId: b.memberId, id: keyOf(b.memberId), amount: b.netMinor }));
  const debtors = balances.filter((b) => b.netMinor < 0).map((b) => ({ memberId: b.memberId, id: keyOf(b.memberId), amount: -b.netMinor }));

  const result: GroupSettlementSuggestion[] = [];
  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(byAmount);
    debtors.sort(byAmount);
    const creditor = creditors[0]!;
    const debtor = debtors[0]!;
    const amount = Math.min(creditor.amount, debtor.amount);
    result.push({ from: debtor.memberId, to: creditor.memberId, amountMinor: amount });
    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount === 0) creditors.shift();
    if (debtor.amount === 0) debtors.shift();
  }
  return result;
}

/** Who should pay whom, and how much, to settle the group (see the note at the top of this file). */
export function suggestGroupSettlements(
  positions: GroupMemberPosition[],
  direct: Map<string, number>,
): GroupSettlementSuggestion[] {
  const suggestions: GroupSettlementSuggestion[] = [];
  for (const [personId, amount] of [...direct.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (amount > 0) suggestions.push({ from: personId, to: null, amountMinor: amount });
    else if (amount < 0) suggestions.push({ from: null, to: personId, amountMinor: -amount });
  }

  // What's left of each member's position once their direct balance with you is
  // taken out. These always sum to zero, because your own net is exactly the sum of
  // your direct balances.
  const residual = positions
    .filter((p) => p.memberId !== null)
    .map((p) => ({ memberId: p.memberId, netMinor: p.netMinor + (direct.get(p.memberId!) ?? 0) }));

  return [...suggestions, ...simplifyDebts(residual)];
}

/** What a member still owes / is owed among the other members, once their direct balance with you is set aside. */
export function residualBalance(position: GroupMemberPosition, direct: Map<string, number>): number {
  return position.memberId === null ? 0 : position.netMinor + (direct.get(position.memberId) ?? 0);
}
