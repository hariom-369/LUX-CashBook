import { describe, expect, it } from 'vitest';
import { smtpOptions } from '../src/lib/mailer.js';

const base = { SMTP_HOST: 'smtp.example.com', SMTP_PORT: 587, SMTP_SECURE: false, SMTP_USER: 'u', SMTP_PASS: 'p', isProduction: true };

describe('SMTP connection options (docs/DEPLOYMENT.md)', () => {
  it('requires STARTTLS in production when the connection is not already TLS', () => {
    expect(smtpOptions(base)).toMatchObject({ host: 'smtp.example.com', port: 587, secure: false, requireTLS: true });
  });

  it('uses implicit TLS as given, and does not also demand STARTTLS', () => {
    expect(smtpOptions({ ...base, SMTP_PORT: 465, SMTP_SECURE: true })).toMatchObject({ port: 465, secure: true, requireTLS: false });
  });

  it('does not force TLS in development, so a local mail catcher still works', () => {
    expect(smtpOptions({ ...base, isProduction: false }).requireTLS).toBe(false);
  });

  it('defaults the port and omits auth when no user is configured', () => {
    const options = smtpOptions({ ...base, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASS: undefined });
    expect(options.port).toBe(587);
    expect(options.auth).toBeUndefined();
  });

  it('never relaxes certificate validation', () => {
    expect(JSON.stringify(smtpOptions(base))).not.toMatch(/rejectUnauthorized|ignoreTLS/);
  });
});
