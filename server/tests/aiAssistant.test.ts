import { beforeEach, describe, expect, it } from 'vitest';
import { bestMatch } from '../src/modules/ai/ai.service.js';
import { as, createTestUser, type TestUser } from './helpers.js';

/**
 * AI assistant (docs — Phase 10). This test environment never sets
 * ANTHROPIC_API_KEY (tests/setup.ts strips `server/.env`), so every endpoint
 * here is exercised in its "not configured" steady state — the same
 * graceful-degradation contract SMTP and push already have. The actual
 * tool-use/extraction flow needs a real provider key and is out of reach of
 * this suite; `bestMatch` (the pure name-resolution helper draft extraction
 * relies on) is covered directly instead.
 */

let user: TestUser;

beforeEach(async () => {
  user = await createTestUser();
});

describe('status', () => {
  it('reports unconfigured and no consent by default', async () => {
    const res = await as(user).get('/api/v1/ai/status').expect(200);
    expect(res.body.data).toEqual({ configured: false, consentGiven: false });
  });

  it('reflects consent once the user opts in, independent of whether a provider key is configured', async () => {
    await as(user).patch('/api/v1/users/me/preferences').send({ aiAssistantEnabled: true }).expect(200);
    const res = await as(user).get('/api/v1/ai/status').expect(200);
    expect(res.body.data).toEqual({ configured: false, consentGiven: true });
  });
});

describe('ask / draft — not configured', () => {
  it('refuses /ai/ask with a clean "not configured" message, never a crash', async () => {
    await as(user).patch('/api/v1/users/me/preferences').send({ aiAssistantEnabled: true }).expect(200);
    const res = await as(user).post('/api/v1/ai/ask').send({ question: 'How much did I spend this month?' }).expect(400);
    expect(res.body.error.message).toMatch(/not configured/i);
  });

  it('refuses /ai/draft with a clean "not configured" message', async () => {
    await as(user).patch('/api/v1/users/me/preferences').send({ aiAssistantEnabled: true }).expect(200);
    const res = await as(user).post('/api/v1/ai/draft').send({ text: 'Paid 450 for groceries at DMart' }).expect(400);
    expect(res.body.error.message).toMatch(/not configured/i);
  });

  it('refuses even with consent off, citing consent rather than the unconfigured provider is irrelevant here — configuration is checked first', async () => {
    const res = await as(user).post('/api/v1/ai/ask').send({ question: 'test' }).expect(400);
    expect(res.body.error.message).toMatch(/not configured/i);
  });
});

describe('bestMatch (draft name resolution)', () => {
  const candidates = [{ name: 'Groceries' }, { name: 'Fuel' }, { name: 'Dining Out' }];

  it('prefers an exact, case-insensitive match', () => {
    expect(bestMatch('groceries', candidates)?.name).toBe('Groceries');
  });

  it('falls back to a prefix match', () => {
    expect(bestMatch('Din', candidates)?.name).toBe('Dining Out');
  });

  it('falls back to a substring match', () => {
    expect(bestMatch('Out', candidates)?.name).toBe('Dining Out');
  });

  it('returns null rather than guessing when nothing matches', () => {
    expect(bestMatch('Travel', candidates)).toBeNull();
  });

  it('returns null for an empty or missing guess', () => {
    expect(bestMatch(undefined, candidates)).toBeNull();
    expect(bestMatch('   ', candidates)).toBeNull();
  });
});
