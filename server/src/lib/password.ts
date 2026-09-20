import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing with scrypt from Node's standard library.
 *
 * scrypt is memory-hard, which is the property that matters against GPU cracking,
 * and it ships with Node — no native module, no build toolchain, nothing to break
 * on a Windows dev machine or in a slim Alpine image.
 *
 * Parameters follow the OWASP minimum for scrypt (N ≥ 2^15, r = 8, p = 1). The
 * cost parameters are stored *inside* the hash string, so they can be raised later
 * and old hashes keep verifying; `needsRehash()` tells the login path when to
 * transparently upgrade a user's stored hash.
 */
const ALGORITHM = 'scrypt';
const N = 2 ** 15; // CPU/memory cost
const r = 8; // block size
const p = 1; // parallelisation
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// scrypt needs roughly 128 * N * r bytes; the default 32 MB limit is too low for N=2^15.
const MAX_MEMORY = 256 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 256;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = await scrypt(normalize(password), salt, KEY_LENGTH, { N, r, p, maxmem: MAX_MEMORY });
  return [ALGORITHM, N, r, p, salt.toString('base64'), derived.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;

  try {
    const derived = await scrypt(normalize(password), parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: MAX_MEMORY,
    });
    // Constant-time: a timing side channel here would leak the hash prefix.
    return derived.length === parsed.hash.length && crypto.timingSafeEqual(derived, parsed.hash);
  } catch {
    return false;
  }
}

/** True when a stored hash uses weaker parameters than the current policy. */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  if (!parsed) return true;
  return parsed.N < N || parsed.r < r || parsed.p < p || parsed.hash.length < KEY_LENGTH;
}

function parse(stored: string) {
  const parts = stored?.split('$');
  if (!parts || parts.length !== 6 || parts[0] !== ALGORITHM) return null;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const parsedN = Number(nStr);
  const parsedR = Number(rStr);
  const parsedP = Number(pStr);
  if (!Number.isInteger(parsedN) || !Number.isInteger(parsedR) || !Number.isInteger(parsedP)) {
    return null;
  }
  return {
    N: parsedN,
    r: parsedR,
    p: parsedP,
    salt: Buffer.from(saltB64!, 'base64'),
    hash: Buffer.from(hashB64!, 'base64'),
  };
}

/**
 * Unicode-normalise so that a password typed with a composed vs decomposed accent
 * still matches, and trim nothing else — leading/trailing spaces are legitimate
 * password characters.
 */
function normalize(password: string): string {
  return password.normalize('NFKC');
}

/** Rough strength signal for the sign-up form. Not a gate; the length rule is the gate. */
export function passwordStrength(password: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  let score = 0;
  if (password.length >= PASSWORD_MIN_LENGTH) score++;
  if (password.length >= 14) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;

  // Obvious patterns pull the score back down regardless of length.
  if (/^(.)\1+$/.test(password) || /^(012|123|abc|qwerty|password)/i.test(password)) score = 0;

  const labels = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;
  const clamped = Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;
  return { score: clamped, label: labels[clamped] };
}
