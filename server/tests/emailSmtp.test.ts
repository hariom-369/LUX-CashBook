import net from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const smtp = vi.hoisted(() => ({ port: 0, mails: [] as Array<{ to: string; raw: string; authed: boolean }> }));

// Production with SMTP configured, pointed at a real SMTP listener started below.
vi.mock('../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/env.js')>();
  return {
    env: {
      ...actual.env,
      emailMode: 'smtp' as const,
      SMTP_HOST: '127.0.0.1',
      get SMTP_PORT() {
        return smtp.port;
      },
      SMTP_SECURE: false,
      SMTP_USER: 'mailer',
      SMTP_PASS: 'the-smtp-password',
      MAIL_FROM: 'Khata <no-reply@example.com>',
      // Not a production boot here, so no STARTTLS is demanded of the local test listener.
      isProduction: false,
    },
  };
});

import { User } from '../src/models/index.js';
import { anon, as, createTestUser, type TestUser } from './helpers.js';

let server: net.Server;

/** A minimal SMTP server that accepts AUTH and records each message. */
beforeAll(async () => {
  server = net.createServer((socket) => {
    socket.write('220 test ESMTP\r\n');
    let buffer = '';
    let inData = false;
    let authed = false;
    let to = '';
    let body: string[] = [];
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index: number;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            smtp.mails.push({ to, raw: body.join('\n'), authed });
            body = [];
            socket.write('250 queued\r\n');
          } else body.push(line);
        } else if (/^EHLO/i.test(line)) socket.write('250-test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
        else if (/^AUTH/i.test(line)) {
          authed = true;
          socket.write('235 ok\r\n');
        } else if (/^RCPT TO/i.test(line)) {
          to = line;
          socket.write('250 ok\r\n');
        } else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write('354 go\r\n');
        } else if (/^QUIT/i.test(line)) {
          socket.write('221 bye\r\n');
          socket.end();
        } else socket.write('250 ok\r\n');
      }
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  smtp.port = (server.address() as net.AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

let user: TestUser;

beforeEach(async () => {
  smtp.mails.length = 0;
  user = await createTestUser();
});

const decoded = (raw: string) => raw.replace(/=\r?\n/g, '').replace(/=3D/g, '=');

describe('with SMTP configured, email works normally', () => {
  it('sends the confirmation email at sign-up, through an authenticated connection', async () => {
    await vi.waitFor(() => expect(smtp.mails.some((m) => m.to.includes(user.email))).toBe(true));
    const mail = smtp.mails.find((m) => m.to.includes(user.email))!;
    expect(mail.authed).toBe(true);
    expect(decoded(mail.raw)).toMatch(/verify-email\?token=/);
    expect(mail.raw).not.toContain('the-smtp-password');
  });

  it('re-sends the confirmation email on request', async () => {
    smtp.mails.length = 0;
    await as(user).post('/api/v1/auth/resend-verification').expect(200);
    expect(smtp.mails).toHaveLength(1);
  });

  it('sends a password-reset link, identical in outcome for a registered and an unknown address', async () => {
    const known = await anon().post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(200);
    const unknown = await anon().post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.com' }).expect(200);
    expect(unknown.body.data.message).toBe(known.body.data.message);
    expect(smtp.mails.filter((m) => /reset-password\?token=/.test(decoded(m.raw)))).toHaveLength(1);
    const stored = await User.findOne({ email: user.email }).select('+passwordResetTokenHash');
    expect(stored?.passwordResetTokenHash).toBeTruthy();
  });

  it('the emailed reset link really resets the password', async () => {
    await anon().post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(200);
    const mail = smtp.mails.find((m) => /reset-password\?token=/.test(decoded(m.raw)))!;
    const token = decoded(mail.raw).match(/reset-password\?token=([A-Za-z0-9_%-]+)/)![1]!;
    await anon().post('/api/v1/auth/reset-password').send({ token: decodeURIComponent(token), password: 'Brand-New-Horse-7!' }).expect(200);
    await anon().post('/api/v1/auth/login').send({ email: user.email, password: 'Brand-New-Horse-7!' }).expect(200);
  });
});
