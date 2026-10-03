import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateServerMessage } from './serverMessages';
import { en } from './messages/en';
import { hi } from './messages/hi';

const t = (text: string) => translateServerMessage('hi', text);

describe('translateServerMessage (§Phase 14 — server-originated text)', () => {
  it('leaves English exactly as the server wrote it', () => {
    expect(translateServerMessage('en', 'That PIN is not correct.')).toBe('That PIN is not correct.');
    expect(translateServerMessage('en', 'Anything at all')).toBe('Anything at all');
  });

  it('translates a sentence with fixed wording by its exact text', () => {
    expect(t('That PIN is not correct.')).toBe(hi['server.thatPinIsNotCorrect']);
    expect(t('This feature is available in a business workspace.')).toContain('बिज़नेस');
  });

  it('shows a sentence it does not know as written, never blank', () => {
    expect(t('A brand new server message.')).toBe('A brand new server message.');
    expect(t('')).toBe('');
    expect(t('That PIN is not correct')).toBe('That PIN is not correct'); // no near-matching
  });

  it('translates "<thing> not found." with the thing named in the language', () => {
    expect(t('Account not found.')).toBe('अकाउंट उपलब्ध नहीं है।');
    expect(t('Recurring transaction not found.')).toContain('आवर्ती लेन-देन');
    // A thing the catalogue has no name for stays whole, in English, rather than half translated.
    expect(t('Spaceship not found.')).toBe('Spaceship not found.');
  });

  it('carries names and amounts through sentences that include them', () => {
    expect(t('Cash would go below zero. Available balance is ₹1,200.')).toBe('Cash शून्य से नीचे चला जाएगा। उपलब्ध शेष ₹1,200 है।');
    expect(t('That is more than the outstanding amount of ₹500.')).toContain('₹500');
    expect(t('October 2026 has been closed. Reopen it before recording or changing transactions in that period.')).toContain('October 2026');
    expect(t('Files must be under 10MB.')).toContain('10MB');
    expect(t('You already have a payee named "Ravi".')).toContain('"Ravi"');
    expect(t('Not enough stock — only 3 of "Pen" available.')).toContain('"Pen"');
    expect(t('"Food" is an expense category.')).toContain('"Food"');
    expect(t("Ravi's account is already settled.")).toContain('Ravi');
  });

  it('uses the right plural for "try again in N minutes"', () => {
    expect(t('Too many failed attempts. Try again in 1 minute.')).toContain('1 मिनट');
    expect(t('Too many failed attempts. Try again in 15 minutes.')).toContain('15 मिनट');
    expect(t('Too many wrong PINs. Try again in 2 minutes, or sign in with your password.')).toContain('2 मिनट');
  });

  it('translates the dashboard insights the server composes', () => {
    expect(t('You saved ₹12,000 this month.')).toBe('आपने इस महीने ₹12,000 बचाए।');
    expect(t('You spent ₹500 more than you earned this month.')).toContain('₹500');
    expect(t('Your largest expense category is Food at ₹8,000.')).toContain('Food');
    expect(t('Your largest expense category is Bills at home at ₹8,000.')).toContain('Bills at home');
    expect(t('You spent ₹1,000 less on Fuel this month than last month.')).toContain('कम');
    expect(t('You spent ₹1,000 more on Fuel this month than last month.')).toContain('ज़्यादा');
    expect(t('₹3,000 is currently outstanding from 1 person.')).toContain('1 व्यक्ति');
    expect(t('₹3,000 is currently outstanding from 4 people.')).toContain('4 लोगों');
    expect(t('You owe ₹700 in total.')).toContain('₹700');
  });

  it('translates the security-activity lines', () => {
    expect(t('Signed in')).toBe(hi['audit.signedIn']);
    expect(t('Password changed')).toBe(hi['audit.passwordChanged']);
    expect(t('Account created for asha@example.com')).toContain('asha@example.com');
  });

  it('does not let a pattern swallow an unrelated sentence', () => {
    expect(t('Your account could not be found. Please sign in again.')).toBe(hi['server.yourAccountCouldNotBeFound2']);
    expect(t('You owe Ravi')).toBe('You owe Ravi');
  });
});

/**
 * The guard: a fixed-wording message added to the server without a catalogue line shows up here, in the
 * language-parity-checked catalogue, instead of reaching a Hindi user as English.
 */
describe('every server error message has a translation', () => {
  const root = join(process.cwd(), '..', 'server', 'src');
  const files: string[] = [];
  (function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.ts')) files.push(full);
    }
  })(root);

  const CALL = /\b(?:conflict|badRequest|forbidden|notFound|unauthorized|validationError|tooManyRequests|internal|invalidAmount|new AppError)\(\s*(?:\d+,\s*'[A-Z_]+',\s*)?(['"`])((?:\\.|(?!\1).)*)\1/gs;
  const messages = new Set<string>();
  const entities = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(CALL)) {
      const body = match[2]!.replace(/\\'/g, "'").replace(/\\"/g, '"');
      if (body.includes('${')) continue; // composed from values: covered by the patterns above
      if (text.slice(match.index, match.index! + 8) === 'notFound') entities.add(body);
      else messages.add(body);
    }
  }

  it('found the server sources and a plausible number of messages', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(messages.size).toBeGreaterThan(100);
    expect(entities.size).toBeGreaterThan(20);
  });

  it('has a Hindi sentence for every fixed-wording message', () => {
    const missing = [...messages].filter((m) => t(m) === m);
    expect(missing).toEqual([]);
  });

  it('names every "<thing> not found." entity in Hindi', () => {
    const missing = [...entities].filter((e) => t(`${e} not found.`) === `${e} not found.`);
    expect(missing).toEqual([]);
  });

  it('keeps every server sentence in the English catalogue identical to what the server sends', () => {
    // The English value *is* the lookup key, so a typo here would silently stop a message matching.
    for (const message of messages) {
      const key = Object.keys(en).find((k) => k.startsWith('server.') && en[k as keyof typeof en] === message);
      const handledByPattern = !key && translateServerMessage('hi', message) !== message;
      expect(key !== undefined || handledByPattern, message).toBe(true);
    }
  });
});
