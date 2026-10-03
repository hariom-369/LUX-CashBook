import { en, type MessageKey } from './messages/en';
import { translate, translatePlural, type Language } from './index';

/**
 * Server-originated text (§Phase 14 follow-up).
 *
 * The API answers in English with a stable `code`. Rather than change every server error
 * into a structured event, the client recognises the server's own sentences and shows the
 * catalogue's translation of them: a message with fixed wording is looked up by its exact
 * English text (`server.*` keys, whose English value *is* the server's sentence), and the
 * few that carry a name or an amount are matched by pattern (`error.*`, `entity.*`).
 *
 * Anything not recognised is shown exactly as the server wrote it — never blank, never
 * guessed. `serverMessages.test.ts` reads the server's source and fails when a new fixed
 * message is added there without a catalogue entry, so this cannot drift unnoticed.
 */

let byEnglish: Map<string, MessageKey> | null = null;

function lookup(): Map<string, MessageKey> {
  if (byEnglish) return byEnglish;
  byEnglish = new Map();
  for (const [key, text] of Object.entries(en)) {
    if (key.startsWith('server.')) byEnglish.set(text, key as MessageKey);
  }
  return byEnglish;
}

const ENTITY_KEYS = new Map<string, MessageKey>();
const AUDIT_KEYS = new Map<string, MessageKey>();
for (const [key, text] of Object.entries(en)) {
  if (key.startsWith('entity.')) ENTITY_KEYS.set(text, key as MessageKey);
  if (key.startsWith('audit.') && !text.includes('{')) AUDIT_KEYS.set(text, key as MessageKey);
}

type Builder = (language: Language, match: RegExpExecArray) => string | null;

const PATTERNS: Array<{ re: RegExp; build: Builder }> = [
  {
    re: /^(.+) not found\.$/,
    build: (language, m) => {
      const entityKey = ENTITY_KEYS.get(m[1]!);
      // An entity the catalogue does not know stays in the server's English rather than being half translated.
      return entityKey ? translate(language, 'error.notFound', { what: translate(language, entityKey) }) : null;
    },
  },
  {
    re: /^(.+) would go below zero\. Available balance is (.+)\.$/,
    build: (language, m) => translate(language, 'error.insufficientBalance', { account: m[1]!, available: m[2]! }),
  },
  {
    re: /^That is more than the outstanding amount of (.+)\.$/,
    build: (language, m) => translate(language, 'error.overRepayment', { amount: m[1]! }),
  },
  {
    re: /^(.+) has been closed\. Reopen it before recording or changing transactions in that period\.$/,
    build: (language, m) => translate(language, 'error.periodClosed', { label: m[1]! }),
  },
  { re: /^Files must be under (\d+)MB\.$/, build: (language, m) => translate(language, 'error.fileTooLarge', { mb: m[1]! }) },
  {
    re: /^Too many failed attempts\. Try again in (\d+) minutes?\.$/,
    build: (language, m) => translatePlural(language, 'error.tooManyFailed', Number(m[1])),
  },
  {
    re: /^Too many wrong PINs\. Try again in (\d+) minutes?, or sign in with your password\.$/,
    build: (language, m) => translatePlural(language, 'error.tooManyPins', Number(m[1])),
  },
  {
    re: /^You already have an import profile named "(.+)"\.$/,
    build: (language, m) => translate(language, 'error.importProfileExists', { name: m[1]! }),
  },
  {
    re: /^You already have a payee named "(.+)"\.$/,
    build: (language, m) => translate(language, 'error.payeeExists', { name: m[1]! }),
  },
  {
    re: /^Not enough stock .{1,3} only (\d+) of "(.+)" available\.$/,
    build: (language, m) => translate(language, 'error.notEnoughStock', { qty: m[1]!, name: m[2]! }),
  },
  { re: /^(.+)'s account is already settled\.$/, build: (language, m) => translate(language, 'error.alreadySettled', { name: m[1]! }) },
  { re: /^A tag can be at most (\d+) characters\.$/, build: (language, m) => translate(language, 'error.tagTooLong', { max: m[1]! }) },
  {
    re: /^"(.+)" is an (income|expense) category\.$/,
    build: (language, m) => translate(language, m[2] === 'income' ? 'error.categoryKind.income' : 'error.categoryKind.expense', { name: m[1]! }),
  },
  { re: /^Choose who this (.+) involves\.$/, build: (language, m) => translate(language, 'error.chooseWho', { what: m[1]! }) },
  // Dashboard insights - sentences the server composes from the month's figures.
  { re: /^You saved (.+) this month\.$/, build: (language, m) => translate(language, 'insight.saved', { amount: m[1]! }) },
  {
    re: /^You spent (.+) more than you earned this month\.$/,
    build: (language, m) => translate(language, 'insight.overspent', { amount: m[1]! }),
  },
  {
    re: /^Your largest expense category is (.+) at (.+?)\.$/,
    build: (language, m) => translate(language, 'insight.topCategory', { name: m[1]!, amount: m[2]! }),
  },
  {
    re: /^You spent (.+?) (more|less) on (.+) this month than last month\.$/,
    build: (language, m) => translate(language, m[2] === 'more' ? 'insight.moreOn' : 'insight.lessOn', { amount: m[1]!, name: m[3]! }),
  },
  {
    re: /^(.+) is currently outstanding from (\d+) (?:person|people)\.$/,
    build: (language, m) => translatePlural(language, 'insight.receivable', Number(m[2]), { amount: m[1]! }),
  },
  { re: /^You owe (.+) in total\.$/, build: (language, m) => translate(language, 'insight.payable', { amount: m[1]! }) },
  // Security-activity summaries.
  { re: /^Account created for (.+)$/, build: (language, m) => translate(language, 'audit.accountCreated', { email: m[1]! }) },
  {
    re: /^Repayments of (.+) have already been recorded against this\.$/,
    build: (language, m) => translate(language, 'error.repaymentsRecorded', { amount: m[1]! }),
  },
];

/** The server's sentence in `language`, or the sentence itself when it is English or not one the catalogue knows. */
export function translateServerMessage(language: Language, text: string): string {
  if (language === 'en' || !text) return text;
  const key = lookup().get(text) ?? AUDIT_KEYS.get(text);
  if (key) return translate(language, key);
  for (const { re, build } of PATTERNS) {
    const match = re.exec(text);
    if (match) {
      const built = build(language, match);
      if (built) return built;
    }
  }
  return text;
}
