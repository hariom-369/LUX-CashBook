import { describe, expect, it } from 'vitest';
import { User } from '../src/models/index.js';
import { anon, app, as, createTestUser } from './helpers.js';
import request from 'supertest';

describe('registration', () => {
  it('creates a user, a default workspace and a starting cash account', async () => {
    const response = await anon()
      .post('/api/v1/auth/register')
      .send({ name: 'Asha', email: 'asha@example.com', password: 'Correct-Horse-9!' })
      .expect(201);

    const { data } = response.body;
    expect(data.user.email).toBe('asha@example.com');
    expect(data.user.emailVerified).toBe(false);
    expect(data.workspaces).toHaveLength(1);
    expect(data.workspaces[0].mode).toBe('personal');
    expect(data.workspaces[0].currency).toBe('INR');
    expect(typeof data.accessToken).toBe('string');
  });

  it('sets the refresh token as an httpOnly, SameSite=Strict cookie', async () => {
    const response = await anon()
      .post('/api/v1/auth/register')
      .send({ name: 'Asha', email: 'cookie@example.com', password: 'Correct-Horse-9!' })
      .expect(201);

    const cookies = response.headers['set-cookie'] as unknown as string[];
    const refresh = cookies.find((c) => c.startsWith('khata_rt='))!;

    expect(refresh).toBeDefined();
    expect(refresh).toContain('HttpOnly');
    expect(refresh).toContain('SameSite=Strict');
    expect(refresh).toContain('Path=/api/v1/auth');
  });

  it('never stores the password in plain text', async () => {
    await anon()
      .post('/api/v1/auth/register')
      .send({ name: 'Asha', email: 'hash@example.com', password: 'Correct-Horse-9!' })
      .expect(201);

    const stored = await User.findOne({ email: 'hash@example.com' }).select('+passwordHash').lean();
    expect(stored!.passwordHash).not.toContain('Correct-Horse-9!');
    expect(stored!.passwordHash.startsWith('scrypt$')).toBe(true);
  });

  it('never serialises the password hash in a response', async () => {
    const user = await createTestUser();
    const response = await as(user).get('/api/v1/users/me').expect(200);
    expect(JSON.stringify(response.body)).not.toContain('scrypt$');
    expect(response.body.data.passwordHash).toBeUndefined();
  });

  it('rejects a weak or malformed payload with per-field messages', async () => {
    const response = await anon()
      .post('/api/v1/auth/register')
      .send({ name: '', email: 'not-an-email', password: 'short' })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    const paths = response.body.error.fields.map((f: { path: string }) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });

  it('refuses a duplicate email', async () => {
    const payload = { name: 'Asha', email: 'dup@example.com', password: 'Correct-Horse-9!' };
    await anon().post('/api/v1/auth/register').send(payload).expect(201);

    const response = await anon().post('/api/v1/auth/register').send(payload).expect(409);
    expect(response.body.error.message).toMatch(/already exists/i);
  });
});

describe('login', () => {
  it('signs in with the correct password', async () => {
    const user = await createTestUser();
    const response = await anon()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);

    expect(response.body.data.user.email).toBe(user.email);
  });

  it('gives the same message for a wrong password and an unknown account', async () => {
    const user = await createTestUser();

    const wrongPassword = await anon()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'definitely-not-it' })
      .expect(401);

    const unknownAccount = await anon()
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@example.com', password: 'definitely-not-it' })
      .expect(401);

    // Different messages here would turn login into an account-existence oracle.
    expect(wrongPassword.body.error.message).toBe(unknownAccount.body.error.message);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks the account after repeated failures', async () => {
    const user = await createTestUser();

    for (let attempt = 0; attempt < 8; attempt++) {
      await anon()
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'wrong' })
        .expect(401);
    }

    const locked = await anon()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(403);

    expect(locked.body.error.message).toMatch(/too many failed attempts/i);
  });
});

describe('access control', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await anon().get('/api/v1/users/me').expect(401);
    expect(response.body.error.code).toBe('NO_TOKEN');
  });

  it('rejects a forged token', async () => {
    const response = await request(app())
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer not.a.real.token')
      .expect(401);

    expect(response.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects a token signed with the wrong secret', async () => {
    const jwt = await import('jsonwebtoken');
    const forged = jwt.default.sign(
      { sub: '507f1f77bcf86cd799439011', sid: 'x', email: 'a@b.c', tv: 0 },
      'an-entirely-different-secret-value-here',
      { issuer: 'khata', audience: 'khata-app', expiresIn: '15m' },
    );

    await request(app()).get('/api/v1/users/me').set('Authorization', `Bearer ${forged}`).expect(401);
  });
});

describe('workspace isolation', () => {
  it("refuses to read another user's workspace", async () => {
    const owner = await createTestUser();
    const attacker = await createTestUser();

    const response = await as(attacker)
      .get(`/api/v1/workspaces/${owner.workspaceId}`)
      .expect(404);

    // 404 rather than 403: confirming existence is itself a leak.
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it("ignores a spoofed X-Workspace-Id pointing at another user's workspace", async () => {
    const owner = await createTestUser();
    const attacker = await createTestUser();

    const response = await request(app())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${attacker.token}`)
      .set('X-Workspace-Id', owner.workspaceId)
      .expect(200);

    expect(response.body.data.id).toBe(attacker.userId);
  });

  it("refuses to modify another user's workspace", async () => {
    const owner = await createTestUser();
    const attacker = await createTestUser();

    await as(attacker)
      .patch(`/api/v1/workspaces/${owner.workspaceId}`)
      .send({ name: 'Owned' })
      .expect(404);
  });
});

describe('refresh token rotation', () => {
  it('rotates the refresh token on every use', async () => {
    const user = await createTestUser();

    const response = await anon()
      .post('/api/v1/auth/refresh')
      .set('Cookie', user.refreshCookie)
      .expect(200);

    const cookies = response.headers['set-cookie'] as unknown as string[];
    const rotated = cookies.find((c) => c.startsWith('khata_rt='))!.split(';')[0];
    expect(rotated).not.toBe(user.refreshCookie);
  });

  it('revokes the whole family when a rotated token is replayed', async () => {
    const user = await createTestUser();

    const first = await anon()
      .post('/api/v1/auth/refresh')
      .set('Cookie', user.refreshCookie)
      .expect(200);
    const rotated = (first.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('khata_rt='))!
      .split(';')[0]!;

    // Replay the token that was already exchanged — the theft signal.
    const replay = await anon()
      .post('/api/v1/auth/refresh')
      .set('Cookie', user.refreshCookie)
      .expect(401);
    expect(replay.body.error.code).toBe('REFRESH_REUSED');

    // The legitimate successor is revoked too: the session is assumed compromised.
    await anon().post('/api/v1/auth/refresh').set('Cookie', rotated).expect(401);
  });

  it('stops working after logout', async () => {
    const user = await createTestUser();

    await anon().post('/api/v1/auth/logout').set('Cookie', user.refreshCookie).expect(200);
    await anon().post('/api/v1/auth/refresh').set('Cookie', user.refreshCookie).expect(401);
  });
});

describe('password reset', () => {
  it('responds identically for known and unknown addresses', async () => {
    const user = await createTestUser();

    const known = await anon().post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(200);
    const unknown = await anon()
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@example.com' })
      .expect(200);

    expect(known.body).toEqual(unknown.body);
  });

  it('invalidates every existing session when the password changes', async () => {
    const user = await createTestUser();

    await as(user)
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: user.password, newPassword: 'A-Whole-New-Password-1!' })
      .expect(200);

    // The access token was minted with the previous tokenVersion.
    const response = await as(user).get('/api/v1/users/me').expect(401);
    expect(response.body.error.code).toBe('TOKEN_REVOKED');

    await anon().post('/api/v1/auth/refresh').set('Cookie', user.refreshCookie).expect(401);
  });

  it('rejects a change with the wrong current password', async () => {
    const user = await createTestUser();
    await as(user)
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: 'not-my-password', newPassword: 'A-Whole-New-Password-1!' })
      .expect(401);
  });
});

describe('preferences', () => {
  it('merges a partial patch instead of replacing the whole object', async () => {
    const user = await createTestUser();

    const response = await as(user)
      .patch('/api/v1/users/me/preferences')
      .send({ theme: 'dark', notifications: { moneyDue: false } })
      .expect(200);

    const { preferences } = response.body.data;
    expect(preferences.theme).toBe('dark');
    expect(preferences.notifications.moneyDue).toBe(false);
    // Everything not mentioned must survive untouched.
    expect(preferences.notifications.budgetAlerts).toBe(true);
    expect(preferences.currency).toBe('INR');
    expect(preferences.dateFormat).toBe('dd MMM yyyy');
  });

  it('rejects unknown fields rather than silently ignoring them', async () => {
    const user = await createTestUser();
    await as(user)
      .patch('/api/v1/users/me/preferences')
      .send({ theme: 'light', isAdmin: true })
      .expect(422);

    // And nothing from the rejected payload was applied.
    const after = await as(user).get('/api/v1/users/me').expect(200);
    expect(after.body.data.preferences.theme).toBe('system');
  });
});

describe('error handling', () => {
  it('returns a structured error with a request id for an unknown route', async () => {
    const response = await anon().get('/api/v1/nope').expect(404);
    expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(typeof response.body.error.requestId).toBe('string');
  });

  it('never leaks a stack trace to the client', async () => {
    const response = await anon()
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{ this is not json')
      .expect(400);

    expect(response.body.error.code).toBe('MALFORMED_JSON');
    expect(JSON.stringify(response.body)).not.toMatch(/at \w+ \(/);
  });
});
