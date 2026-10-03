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
/**
 * Something the parser could not work out. It is named, never guessed (§Phase 2 "Quick Entry 2.0"):
 * the form shows it as a plain question and the field stays for the person to fill in.
 */
export interface ParseQuestion {
  field: 'account' | 'toAccount' | 'person' | 'amount';
  /** For an ambiguous answer: the ids it could be, so the form can offer exactly those. */
  candidates?: string[];
}

export interface ParsedQuickEntry {
  type: TransactionType;
  amountMinor: number | null;
  date: string;
  description: string;
  categoryId?: string;
  personId?: string;
  /** The account the money moved through ("using UPI", "from SBI") — or, for a transfer, the one it left. */
  accountId?: string;
  /** Transfers only: the account it arrived in ("... to HDFC"). */
  toAccountId?: string;
  /** What could not be worked out. Empty means nothing was left to ask. */
  questions: ParseQuestion[];
  /** True once a type and an amount were both found — enough to prefill with confidence. */
  matched: boolean;
}

export interface ParseContext {
  categories: Array<{ id: string; name: string }>;
  people: Array<{ id: string; name: string }>;
  /** Optional: with accounts the parser can read "from SBI" / "using UPI" and transfers between two of them. */
  accounts?: Array<{ id: string; name: string; type?: string }>;
  today?: Date;
}

const LEND_WORDS = /\b(lent|loaned)\b/i;
const BORROW_WORDS = /\b(borrowed|took a loan)\b/i;
const REPAYMENT_WORDS = /\b(repaid|paid back|returned the money|settled up)\b/i;
const TRANSFER_WORDS = /\b(transferred|moved (?:money|cash))\b/i;
const INCOME_WORDS = /\b(received|got|earned|credited|salary|income|refund(?:ed)?|bonus)\b/i;

/** "Rahul owes me", "owes me" - the other person owes you, i.e. you lent. */
const OWES_ME = /\bowes?\s+me\b/i;
/** "I owe Rahul", "owe Rahul" - you owe them, i.e. you borrowed. */
const I_OWE = /\b(?:i\s+)?owe\s+(?!me\b)/i;

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

/** The proper-noun-looking word right after "to"/"from"/"by" — or beside "owes"/"owe" — a person-name guess. */
function findPersonName(text: string): string | null {
  const owes = /\b([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)?)\s+owes?\s+me\b/.exec(text);
  if (owes) return owes[1] ?? null;
  const iOwe = /\b(?:I\s+)?owe\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)?)/.exec(text);
  if (iOwe) return iOwe[1] ?? null;
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
  if (OWES_ME.test(text)) return 'lend';
  if (I_OWE.test(text)) return 'borrow';
  if (LEND_WORDS.test(text)) return 'lend';
  if (BORROW_WORDS.test(text)) return 'borrow';
  if (REPAYMENT_WORDS.test(text)) return 'repayment_received';
  if (TRANSFER_WORDS.test(text)) return 'transfer';
  if (INCOME_WORDS.test(text)) return 'income';
  return 'expense';
}

type AccountRef = NonNullable<ParseContext['accounts']>[number];

/** Words that point at a kind of account rather than naming one ("using UPI", "by card", "from cash"). */
const TYPE_WORDS: Array<{ re: RegExp; types: string[] }> = [
  { re: /\bupi\b/i, types: ['upi'] },
  { re: /\bcash\b/i, types: ['cash'] },
  { re: /\b(?:credit\s*card|card)\b/i, types: ['credit_card'] },
  { re: /\bwallet\b/i, types: ['wallet'] },
  { re: /\bbank\b/i, types: ['bank'] },
];

/** Every place this name appears as a whole word. No pattern is built from the name. */
function indicesOfName(lowerText: string, lowerName: string): number[] {
  const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
  const found: number[] = [];
  let from = 0;
  for (;;) {
    const at = lowerText.indexOf(lowerName, from);
    if (at === -1) return found;
    if (!isWordChar(lowerText[at - 1]) && !isWordChar(lowerText[at + lowerName.length])) found.push(at);
    from = at + 1;
  }
}

/** Every mention of an account, in the order they appear. A longer name wins over one it contains. */
function accountMentions(text: string, accounts: AccountRef[]): Array<{ account: AccountRef; at: number }> {
  const lower = text.toLowerCase();
  const found = accounts
    .filter((a) => a.name.trim().length >= 2)
    .flatMap((account) => indicesOfName(lower, account.name.trim().toLowerCase()).map((at) => ({ account, at })));
  // Drop a hit that sits inside a longer-named hit ("HDFC" inside "HDFC Savings").
  return found
    .filter((hit) => !found.some((other) => other !== hit && other.account.name.length > hit.account.name.length && other.at <= hit.at && other.at + other.account.name.length >= hit.at + hit.account.name.length))
    .sort((a, b) => a.at - b.at);
}

interface AccountReading {
  accountId?: string;
  toAccountId?: string;
  questions: ParseQuestion[];
}

function readAccounts(text: string, type: TransactionType, accounts: AccountRef[]): AccountReading {
  const questions: ParseQuestion[] = [];
  if (accounts.length === 0) return { questions };
  const mentions = accountMentions(text, accounts);
  // One entry per account (its first mention) for everything that is not a transfer.
  const named = mentions.filter((hit, i) => mentions.findIndex((m) => m.account.id === hit.account.id) === i);

  if (type === 'transfer') {
    // "from SBI to HDFC": the one after "from" leaves, the one after "to" receives. Otherwise, order of mention.
    const lower = text.toLowerCase();
    const fromAt = lower.search(/\bfrom\b/);
    const toAt = lower.search(/\bto\b/);
    let from: AccountRef | undefined;
    let to: AccountRef | undefined;
    for (const hit of mentions) {
      if (fromAt !== -1 && hit.at > fromAt && (toAt === -1 || hit.at < toAt || toAt < fromAt) && !from) from = hit.account;
      else if (toAt !== -1 && hit.at > toAt && !to) to = hit.account;
    }
    if (!from && !to && mentions.length >= 2 && mentions[0]!.account.id !== mentions[1]!.account.id) {
      from = mentions[0]!.account;
      to = mentions[1]!.account;
    }
    if (!from) questions.push({ field: 'account' });
    if (!to) questions.push({ field: 'toAccount' });
    return { accountId: from?.id, toAccountId: to?.id, questions };
  }

  // Everything else moves money through one account.
  if (named.length === 1) return { accountId: named[0]!.account.id, questions };
  if (named.length > 1) {
    // Several named - prefer the one after a cue word ("using", "via", "from", "paid by", "in"), else ask.
    const cue = /\b(?:using|via|from|with|by|through|in|on)\s+$/i;
    const cued = named.filter((hit) => cue.test(text.slice(0, hit.at)));
    if (cued.length === 1) return { accountId: cued[0]!.account.id, questions };
    return { questions: [{ field: 'account', candidates: named.map((h) => h.account.id) }] };
  }

  // No name - maybe a kind of account ("using UPI").
  for (const word of TYPE_WORDS) {
    if (!word.re.test(text)) continue;
    const ofKind = accounts.filter((a) => a.type && word.types.includes(a.type));
    if (ofKind.length === 1) return { accountId: ofKind[0]!.id, questions };
    if (ofKind.length > 1) return { questions: [{ field: 'account', candidates: ofKind.map((a) => a.id) }] };
  }

  // Nothing said. With only one account there is nothing to ask; with several, say so rather than guess.
  if (accounts.length > 1) questions.push({ field: 'account' });
  return { questions };
}

export function parseQuickEntry(rawText: string, context: ParseContext): ParsedQuickEntry {
  const text = rawText.trim();
  const today = context.today ?? new Date();

  const amountMinor = findAmountMinor(text);
  const type = detectType(text);
  const date = findDate(text, today);
  const isPersonal = type === 'lend' || type === 'borrow' || type.startsWith('repayment');

  const personId = isPersonal ? findPersonId(text, context.people) : undefined;
  const reading = readAccounts(text, type, context.accounts ?? []);
  const questions: ParseQuestion[] = [];
  if (amountMinor === null && text.length > 0) questions.push({ field: 'amount' });
  if (isPersonal && !personId) questions.push({ field: 'person' });
  questions.push(...reading.questions);

  return {
    type,
    amountMinor,
    date,
    description: text,
    categoryId: isPersonal ? undefined : findCategoryId(text, context.categories),
    personId,
    accountId: reading.accountId,
    toAccountId: reading.toAccountId,
    questions,
    matched: amountMinor !== null && text.length > 0,
  };
}
