import type { RangePreset, TransactionType } from '@khata/shared';

/**
 * Structured questions in the command palette (§Phase 2 — "above ₹5000", "Zomato last 3
 * months", "UPI expenses").
 *
 * This only ever turns words into the filters the transaction list already has; it never
 * runs a query of its own and never invents a meaning. A word that is not clearly a
 * filter stays in the text search, and an account word that matches more than one
 * account is left alone rather than guessed — the palette shows exactly which filters
 * it applied, so a wrong reading is visible and one click from fixed.
 */
export interface SearchAccount {
  id: string;
  name: string;
  type?: string;
}

export interface StructuredSearch {
  /** What is left to match against descriptions, payees and notes. */
  text: string;
  range?: RangePreset;
  types?: TransactionType[];
  accountId?: string;
  minAmountMinor?: number;
  maxAmountMinor?: number;
  /** True when at least one filter was read — otherwise the query is a plain text search. */
  structured: boolean;
}

/** The periods the transaction list offers, so a link built from one always shows a real choice. */
const PERIODS: Array<{ re: RegExp; range: RangePreset }> = [
  { re: /\blast\s+(?:3|three)\s+months?\b/i, range: 'last_3_months' },
  { re: /\blast\s+(?:6|six)\s+months?\b/i, range: 'last_6_months' },
  { re: /\blast\s+(?:7|seven)\s+days\b|\bpast\s+week\b/i, range: 'last_7_days' },
  { re: /\blast\s+(?:30|thirty)\s+days\b/i, range: 'last_30_days' },
  { re: /\blast\s+month\b/i, range: 'last_month' },
  { re: /\bthis\s+month\b/i, range: 'this_month' },
  { re: /\blast\s+year\b/i, range: 'last_year' },
  { re: /\bthis\s+year\b/i, range: 'this_year' },
  { re: /\bthis\s+week\b/i, range: 'this_week' },
  { re: /\btoday\b/i, range: 'today' },
  { re: /\ball\s+time\b/i, range: 'all_time' },
];

const TYPE_WORDS: Array<{ re: RegExp; type: TransactionType }> = [
  { re: /\b(?:expenses?|spent|spending)\b/i, type: 'expense' },
  { re: /\b(?:income|earned|earnings)\b/i, type: 'income' },
  { re: /\btransfers?\b/i, type: 'transfer' },
];

const KIND_WORDS: Array<{ re: RegExp; types: string[] }> = [
  { re: /\bupi\b/i, types: ['upi'] },
  { re: /\bcash\b/i, types: ['cash'] },
  { re: /\b(?:credit\s*card|card)\b/i, types: ['credit_card'] },
  { re: /\bwallet\b/i, types: ['wallet'] },
  { re: /\bbank\b/i, types: ['bank'] },
];

/** "above 5000" / "over ₹5,000" / "> 5k" and "below ₹200" / "under 2 lakh". */
const BOUND = /(?:\b(above|over|more\s+than|greater\s+than|at\s+least|below|under|less\s+than|at\s+most)\b|(>=?|<=?))\s*(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(k|lakhs?|l|crores?|cr)?\b/i;

const MULTIPLIER: Record<string, number> = { k: 1000, l: 100000, lakh: 100000, lakhs: 100000, cr: 10000000, crore: 10000000, crores: 10000000 };

/** Whole-number paise from "5,000" or "1.5" with an optional k/lakh suffix — integer arithmetic only. */
export function toMinor(digits: string, suffix?: string): number | null {
  const [whole = '', fraction = ''] = digits.replace(/,/g, '').split('.');
  if (!/^\d+$/.test(whole) || (fraction && !/^\d{1,2}$/.test(fraction))) return null;
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0') || '0');
  const factor = suffix ? (MULTIPLIER[suffix.toLowerCase()] ?? 1) : 1;
  const minor = paise * factor;
  return Number.isSafeInteger(minor) ? minor : null;
}

export function parseSearchQuery(raw: string, accounts: SearchAccount[] = []): StructuredSearch {
  let text = raw.replace(/\s+/g, ' ').trim();
  const result: StructuredSearch = { text, structured: false };
  const strip = (match: RegExpExecArray) => {
    text = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`.replace(/\s+/g, ' ').trim();
  };

  const bound = BOUND.exec(text);
  if (bound) {
    const minor = toMinor(bound[3]!, bound[4]);
    if (minor !== null) {
      const word = (bound[1] ?? bound[2] ?? '').toLowerCase().replace(/\s+/g, ' ');
      if (/^(above|over|more than|greater than|at least|>=?)$/.test(word)) result.minAmountMinor = minor;
      else result.maxAmountMinor = minor;
      strip(bound);
    }
  }

  for (const period of PERIODS) {
    const match = period.re.exec(text);
    if (match) {
      result.range = period.range;
      strip(match);
      break;
    }
  }

  for (const word of TYPE_WORDS) {
    const match = word.re.exec(text);
    if (match) {
      result.types = [...(result.types ?? []), word.type];
      strip(match);
    }
  }

  result.structured = result.minAmountMinor !== undefined || result.maxAmountMinor !== undefined || result.range !== undefined || result.types !== undefined;

  // An account only counts alongside another filter: a bare "cash" is far more likely a
  // description ("cash withdrawal") than a request for the Cash account.
  if (result.structured) {
    const named = accounts.find((a) => a.name.trim().length >= 2 && new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(a.name.trim())}(?![\\p{L}\\p{N}])`, 'iu').test(text));
    if (named) {
      result.accountId = named.id;
      text = text.replace(new RegExp(escapeRegExp(named.name.trim()), 'i'), ' ').replace(/\s+/g, ' ').trim();
    } else {
      for (const kind of KIND_WORDS) {
        const match = kind.re.exec(text);
        if (!match) continue;
        const ofKind = accounts.filter((a) => a.type && kind.types.includes(a.type));
        // Exactly one account of that kind is unambiguous; several are not guessed between.
        if (ofKind.length === 1) {
          result.accountId = ofKind[0]!.id;
          strip(match);
        }
        break;
      }
    }
  }

  result.text = text;
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The URL the transaction list reads on arrival for this reading. */
export function searchToUrl(search: StructuredSearch): string {
  const params = new URLSearchParams();
  if (search.text) params.set('q', search.text);
  if (search.range) params.set('range', search.range);
  if (search.types?.length) params.set('types', search.types.join(','));
  if (search.accountId) params.set('account', search.accountId);
  if (search.minAmountMinor !== undefined) params.set('min', String(search.minAmountMinor));
  if (search.maxAmountMinor !== undefined) params.set('max', String(search.maxAmountMinor));
  const query = params.toString();
  return query ? `/transactions?${query}` : '/transactions';
}

/** The link for one payee's entries. */
export function payeeToUrl(id: string, name: string): string {
  return `/transactions?${new URLSearchParams({ payee: id, payeeName: name }).toString()}`;
}

/** The periods the transaction list's period menu offers. A link may only set one of these. */
export const LIST_RANGES: RangePreset[] = [
  'today', 'this_week', 'this_month', 'last_month', 'last_7_days', 'last_30_days',
  'last_3_months', 'last_6_months', 'this_year', 'last_year', 'all_time',
];

const LIST_TYPES: TransactionType[] = ['expense', 'income', 'transfer', 'lend', 'borrow', 'repayment_given', 'repayment_received'];

export interface SearchLink {
  q: string;
  range?: RangePreset;
  types?: TransactionType[];
  accountId?: string;
  minAmountMinor?: number;
  maxAmountMinor?: number;
  /** Entries for one payee (a palette payee result), by id with the name to show on the chip. */
  payee?: { id: string; name: string };
  /** Anything beyond a plain text search was set, so the filter panel should be open to show it. */
  hasFilters: boolean;
}

function nonNegativeInt(value: string | null): number | undefined {
  if (value === null || !/^\d{1,15}$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Reads `searchToUrl`'s output back, accepting only values the list itself offers. Anything else is ignored. */
export function readSearchLink(params: URLSearchParams): SearchLink {
  const rangeParam = params.get('range');
  const range = LIST_RANGES.find((r) => r === rangeParam);
  const types = (params.get('types') ?? '')
    .split(',')
    .filter((t): t is TransactionType => (LIST_TYPES as string[]).includes(t));
  const account = params.get('account');
  const accountId = account && /^[A-Za-z0-9_-]{1,40}$/.test(account) ? account : undefined;
  const minAmountMinor = nonNegativeInt(params.get('min'));
  const maxAmountMinor = nonNegativeInt(params.get('max'));
  const payeeId = params.get('payee');
  const payee = payeeId && /^[A-Za-z0-9_-]{1,40}$/.test(payeeId) ? { id: payeeId, name: (params.get('payeeName') ?? '').slice(0, 80) } : undefined;
  return {
    q: (params.get('q') ?? '').slice(0, 120),
    range,
    types: types.length ? types : undefined,
    accountId,
    minAmountMinor,
    maxAmountMinor,
    payee,
    hasFilters: Boolean(types.length || accountId || minAmountMinor !== undefined || maxAmountMinor !== undefined),
  };
}
