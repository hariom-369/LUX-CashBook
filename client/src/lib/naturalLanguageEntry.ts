import { toDateKey, type TransactionType } from '@khata/shared';

/**
 * Natural-language quick entry (§46).
 *
 * This is an *assist*, not an oracle: it turns a sentence like "Paid 250 for
 * lunch yesterday" into a best-guess prefill for the ordinary Quick Add form —
 * type, amount, date, a category/person guess, and the original text kept as
 * the description. It never submits anything itself. The user always lands on
 * the same review screen as manual entry and presses Save themselves, which is
 * what keeps a misparse from ever becoming a wrong transaction — accuracy over
 * automation, per the app's core invariant.
 */
export interface ParsedQuickEntry {
  type: TransactionType;
  amountMinor: number | null;
  date: string;
  description: string;
  categoryId?: string;
  personId?: string;
  /** True once a type and an amount were both found — enough to prefill with confidence. */
  matched: boolean;
}

export interface ParseContext {
  categories: Array<{ id: string; name: string }>;
  people: Array<{ id: string; name: string }>;
  today?: Date;
}

const LEND_WORDS = /\b(lent|loaned)\b/i;
const BORROW_WORDS = /\b(borrowed|took a loan)\b/i;
const REPAYMENT_WORDS = /\b(repaid|paid back|returned the money|settled up)\b/i;
const TRANSFER_WORDS = /\b(transferred|moved (?:money|cash))\b/i;
const INCOME_WORDS = /\b(received|got|earned|credited|salary|income|refund(?:ed)?|bonus)\b/i;

const AMOUNT_PATTERN = /(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:rs\.?|rupees|inr)?/i;

/** A "5th"/"5pm"/"5 am" style number is a date or time, never the amount. */
function isDateOrTimeLikeMatch(text: string, index: number, matchLength: number): boolean {
  const after = text.slice(index + matchLength, index + matchLength + 4).trim().toLowerCase();
  return /^(st|nd|rd|th|am|pm|:)/.test(after);
}

function findAmountMinor(text: string): number | null {
  const re = new RegExp(AMOUNT_PATTERN, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (isDateOrTimeLikeMatch(text, match.index, match[0].length)) continue;
    const digits = match[1]?.replace(/,/g, '');
    if (!digits) continue;
    const value = Number(digits);
    if (!Number.isFinite(value) || value <= 0) continue;
    return Math.round(value * 100);
  }
  return null;
}

function findDate(text: string, today: Date): string {
  if (/\byesterday\b/i.test(text)) {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return toDateKey(d);
  }
  if (/\btoday\b|\btonight\b/i.test(text)) {
    return toDateKey(today);
  }
  return toDateKey(today);
}

/** The proper-noun-looking word right after "to"/"from"/"by" — a person-name guess. */
function findPersonName(text: string): string | null {
  const match = /\b(?:to|from|by)\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)?)/.exec(text);
  return match?.[1] ?? null;
}

function findPersonId(text: string, people: ParseContext['people']): string | undefined {
  const name = findPersonName(text);
  if (!name) return undefined;
  const lower = name.toLowerCase();
  return people.find((p) => p.name.toLowerCase() === lower || p.name.toLowerCase().startsWith(lower))?.id;
}

function findCategoryId(text: string, categories: ParseContext['categories']): string | undefined {
  const lower = text.toLowerCase();
  // Longer names first, so "grocery shopping" beats a coincidental short match.
  const sorted = [...categories].sort((a, b) => b.name.length - a.name.length);
  for (const category of sorted) {
    const name = category.name.toLowerCase();
    if (name.length >= 3 && new RegExp(`\\b${escapeRegExp(name)}\\b`).test(lower)) {
      return category.id;
    }
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectType(text: string): TransactionType {
  if (LEND_WORDS.test(text)) return 'lend';
  if (BORROW_WORDS.test(text)) return 'borrow';
  if (REPAYMENT_WORDS.test(text)) return 'repayment_received';
  if (TRANSFER_WORDS.test(text)) return 'transfer';
  if (INCOME_WORDS.test(text)) return 'income';
  return 'expense';
}

export function parseQuickEntry(rawText: string, context: ParseContext): ParsedQuickEntry {
  const text = rawText.trim();
  const today = context.today ?? new Date();

  const amountMinor = findAmountMinor(text);
  const type = detectType(text);
  const date = findDate(text, today);
  const isPersonal = type === 'lend' || type === 'borrow' || type.startsWith('repayment');

  return {
    type,
    amountMinor,
    date,
    description: text,
    categoryId: isPersonal ? undefined : findCategoryId(text, context.categories),
    personId: isPersonal ? findPersonId(text, context.people) : undefined,
    matched: amountMinor !== null && text.length > 0,
  };
}
