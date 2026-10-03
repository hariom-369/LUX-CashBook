import { beforeEach, describe, expect, it } from 'vitest';
import { as, createTestUser, type TestUser } from './helpers.js';

/** The start-screen preference behind the Daily Money home (§Phase 2). */

let user: TestUser;

beforeEach(async () => {
  user = await createTestUser();
});

describe('homeScreen preference', () => {
  it('defaults to the full dashboard', async () => {
    const res = await as(user).get('/api/v1/users/me').expect(200);
    expect(res.body.data.preferences.homeScreen).toBe('dashboard');
  });

  it('can be switched to the Daily Money view and back, without touching other preferences', async () => {
    const before = (await as(user).get('/api/v1/users/me').expect(200)).body.data.preferences;
    const daily = await as(user).patch('/api/v1/users/me/preferences').send({ homeScreen: 'daily' }).expect(200);
    expect(daily.body.data.preferences.homeScreen).toBe('daily');
    expect(daily.body.data.preferences.currency).toBe(before.currency);
    expect(daily.body.data.preferences.notifications).toEqual(before.notifications);
    const back = await as(user).patch('/api/v1/users/me/preferences').send({ homeScreen: 'dashboard' }).expect(200);
    expect(back.body.data.preferences.homeScreen).toBe('dashboard');
  });

  it('survives an unrelated preference change', async () => {
    await as(user).patch('/api/v1/users/me/preferences').send({ homeScreen: 'daily' }).expect(200);
    const res = await as(user).patch('/api/v1/users/me/preferences').send({ theme: 'dark' }).expect(200);
    expect(res.body.data.preferences.homeScreen).toBe('daily');
  });

  it('refuses a value that is not one of the two screens', async () => {
    await as(user).patch('/api/v1/users/me/preferences').send({ homeScreen: 'somewhere-else' }).expect(422);
    await as(user).patch('/api/v1/users/me/preferences').send({ homeScreen: { $ne: null } }).expect(422);
  });
});
