import { beforeEach, describe, expect, it, vi } from 'vitest';

// Production without SMTP: the same server, with the email service reported as unavailable.
vi.mock('../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/env.js')>();
  return { env: { ...actual.env, emailMode: 'unavailable' as const, SMTP_HOST: undefined } };
});

import { Invitation, User } from '../src/models/index.js';
import { sendMail } from '../src/lib/mailer.js';
import { anon, as, createTestUser, type TestUser } from './helpers.js';

/**
 * SMTP is optional (docs/DEPLOYMENT.md). Without it the server runs, and everything that exists only to send an
 * email answers a clear "email service not configured" error - never a crash, never a pretend success, and never
 * a different answer for an address that is registered (no membership oracle).
 */

let user: TestUser;

beforeEach(async () => {
  user = await createTestUser();
});

const NOT_CONFIGURED = { status: 503, code: 'EMAIL_NOT_CONFIGURED' };

function expectNotConfigured(res: { status: number; body: { ok: boolean; error: { code: string; message: string } } }) {
  expect(res.status).toBe(NOT_CONFIGURED.status);
  expect(res.body.ok).toBe(false);
  expect(res.body.error.code).toBe(NOT_CONFIGURED.code);
  expect(res.body.error.message).toMatch(/email service is not configured/);
  // A clear message, not a leak: no host, user or password of any SMTP setup.
  expect(`${res.body.error.code} ${res.body.error.message}`).not.toMatch(/smtp|password|secret|host|user/i);
}

describe('password reset without an email service', () => {
  it('answers "not configured" for a registered address', async () => {
    expectNotConfigured(await anon().post('/api/v1/auth/forgot-password').send({ email: user.email }));
  });

  it('answers exactly the same for an address nobody registered', async () => {
    const known = await anon().post('/api/v1/auth/forgot-password').send({ email: user.email });
    const unknown = await anon().post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.com' });
    expectNotConfigured(unknown);
    expect(unknown.status).toBe(known.status);
    expect(unknown.body.error.code).toBe(known.body.error.code);
    expect(unknown.body.error.message).toBe(known.body.error.message);
  });

  it('creates no reset token it could never deliver', async () => {
    await anon().post('/api/v1/auth/forgot-password').send({ email: user.email });
    const stored = await User.findOne({ email: user.email }).select('+passwordResetTokenHash +passwordResetExpiresAt');
    expect(stored?.passwordResetTokenHash ?? null).toBeNull();
  });

  it('still validates the request first', async () => {
    await anon().post('/api/v1/auth/forgot-password').send({ email: 'not-an-email' }).expect(422);
  });
});

describe('email verification without an email service', () => {
  it('sign-up still works, leaving the account unconfirmed', async () => {
    expect(user.session.user.emailVerified).toBe(false);
    const stored = await User.findById(user.userId).select('+emailVerificationTokenHash');
    expect(stored?.emailVerificationTokenHash ?? null).toBeNull();
  });

  it('re-sending the confirmation email answers "not configured" and changes nothing', async () => {
    expectNotConfigured(await as(user).post('/api/v1/auth/resend-verification'));
    const stored = await User.findById(user.userId).select('+emailVerificationTokenHash');
    expect(stored?.emailVerificationTokenHash ?? null).toBeNull();
  });
});

describe('everything that does not need email keeps working', () => {
  it('signs in, reads the session and changes the password', async () => {
    await anon().post('/api/v1/auth/login').send({ email: user.email, password: user.password }).expect(200);
    await as(user).get('/api/v1/auth/me').expect(200);
    await as(user).post('/api/v1/auth/change-password').send({ currentPassword: user.password, newPassword: 'Another-Horse-5432' }).expect(200);
  });

  it('refuses an emailed invitation up front, creating none', async () => {
    const invitee = await createTestUser();
    expectNotConfigured(await as(user).post('/api/v1/workspace-invitations').send({ email: invitee.email, role: 'member' }));
    expect(await Invitation.countDocuments({ workspaceId: user.workspaceId })).toBe(0);
  });
});

describe('the mailer itself', () => {
  it('rejects with the not-configured error and sends nothing', async () => {
    await expect(sendMail({ to: 'a@example.com', subject: 's', text: 't', html: '<p>t</p>' })).rejects.toMatchObject({
      statusCode: 503,
      code: 'EMAIL_NOT_CONFIGURED',
    });
  });
});
