import { describe, expect, it } from 'vitest';
import { checkProduction, type ProductionConfig } from '../src/config/productionChecks.js';

const good: ProductionConfig = {
  STORAGE_DRIVER: 's3',
  ALLOW_LOCAL_STORAGE_IN_PRODUCTION: false,
  S3_BUCKET: 'khata-prod',
  S3_REGION: 'ap-south-1',
  S3_ACCESS_KEY_ID: 'AKIA...',
  S3_SECRET_ACCESS_KEY: 'secret',
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'u',
  SMTP_PASS: 'p',
  mailFromExplicit: true,
  APP_URL: 'https://app.example.com',
  API_URL: 'https://api.example.com',
  COOKIE_CROSS_SITE: false,
  COOKIE_SECURE: 'auto',
};
const check = (over: Partial<ProductionConfig>) => checkProduction({ ...good, ...over });

describe('production configuration checks (docs/DEPLOYMENT.md)', () => {
  it('accepts a complete, same-parent-domain configuration with nothing to warn about', () => {
    expect(check({})).toEqual({ problems: [], warnings: [] });
  });

  it('refuses local disk storage unless a persistent disk is explicitly declared', () => {
    expect(check({ STORAGE_DRIVER: 'local' }).problems.join(' ')).toMatch(/STORAGE_DRIVER=local/);
    expect(check({ STORAGE_DRIVER: 'local', ALLOW_LOCAL_STORAGE_IN_PRODUCTION: true }).problems).toEqual([]);
  });

  it('requires the bucket and region for S3, and credentials only as a pair', () => {
    expect(check({ S3_BUCKET: undefined }).problems.join(' ')).toMatch(/S3_BUCKET/);
    expect(check({ S3_REGION: undefined }).problems.join(' ')).toMatch(/S3_REGION/);
    expect(check({ S3_SECRET_ACCESS_KEY: undefined }).problems.join(' ')).toMatch(/together/);
    // Neither key: an IAM role is a legitimate setup.
    expect(check({ S3_ACCESS_KEY_ID: undefined, S3_SECRET_ACCESS_KEY: undefined }).problems).toEqual([]);
  });

  it('does not require SMTP: email is optional, and nothing about it is checked when it is absent', () => {
    const bare = { SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_SECURE: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, MAIL_FROM: undefined, mailFromExplicit: false };
    expect(check(bare)).toEqual({ problems: [], warnings: [] });
    // Stray SMTP leftovers without a host are ignored too, rather than refused.
    expect(check({ ...bare, SMTP_USER: 'u', SMTP_PORT: 99999, MAIL_FROM: 'garbage' }).problems).toEqual([]);
  });

  it('accepts a complete SMTP configuration, with or without a login', () => {
    expect(check({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: 465, SMTP_SECURE: true, MAIL_FROM: 'Khata <no-reply@example.com>' }).problems).toEqual([]);
    expect(check({ SMTP_PORT: 587, SMTP_SECURE: false, MAIL_FROM: 'no-reply@example.com' }).problems).toEqual([]);
    expect(check({ SMTP_USER: undefined, SMTP_PASS: undefined }).problems).toEqual([]);
  });

  it('validates the host, port, TLS mode, login pair and sender - but only once SMTP is configured', () => {
    const problems = (over: Partial<ProductionConfig>) => check({ SMTP_PORT: 587, SMTP_SECURE: false, MAIL_FROM: 'no-reply@example.com', ...over }).problems.join(' | ');
    expect(problems({ SMTP_HOST: 'https://smtp.example.com' })).toMatch(/SMTP_HOST must be a bare host name/);
    expect(problems({ SMTP_HOST: 'smtp.example.com:587' })).toMatch(/SMTP_HOST/);
    expect(problems({ SMTP_HOST: 'smtp example.com' })).toMatch(/SMTP_HOST/);
    expect(problems({ SMTP_PORT: 0 })).toMatch(/SMTP_PORT must be a port number/);
    expect(problems({ SMTP_PORT: 70000 })).toMatch(/SMTP_PORT must be a port number/);
    expect(problems({ SMTP_PORT: 465, SMTP_SECURE: false })).toMatch(/SMTP_PORT=465 expects an implicit-TLS/);
    expect(problems({ SMTP_PORT: 587, SMTP_SECURE: true })).toMatch(/SMTP_PORT=587 upgrades with STARTTLS/);
    expect(problems({ SMTP_PASS: undefined })).toMatch(/SMTP_USER and SMTP_PASS must be set together/);
    expect(problems({ SMTP_USER: undefined })).toMatch(/SMTP_USER and SMTP_PASS must be set together/);
    expect(problems({ mailFromExplicit: false })).toMatch(/MAIL_FROM must be set/);
    expect(problems({ MAIL_FROM: 'not an address' })).toMatch(/MAIL_FROM must be an address/);
    expect(problems({ MAIL_FROM: 'a@example.com\r\nBcc: evil@example.com' })).toMatch(/MAIL_FROM must be an address/);
  });

  it('never repeats a credential in a message', () => {
    const text = JSON.stringify(check({ SMTP_HOST: 'bad host', SMTP_USER: 'super-secret-user', SMTP_PASS: undefined, MAIL_FROM: 'x' }));
    expect(text).not.toContain('super-secret-user');
    const withPass = JSON.stringify(check({ SMTP_HOST: 'bad host', SMTP_USER: undefined, SMTP_PASS: 'hunter2-password' }));
    expect(withPass).not.toContain('hunter2-password');
  });

  it('refuses localhost and plain-http public URLs', () => {
    expect(check({ APP_URL: 'http://localhost:5173' }).problems.join(' ')).toMatch(/APP_URL still points at localhost/);
    expect(check({ API_URL: 'http://127.0.0.1:4000' }).problems.join(' ')).toMatch(/API_URL still points at localhost/);
    expect(check({ API_URL: 'http://api.example.com' }).problems.join(' ')).toMatch(/API_URL must be an https/);
    expect(check({ APP_URL: 'not a url' }).problems.join(' ')).toMatch(/APP_URL must be an https/);
  });

  it('refuses insecure cookies, and warns (not refuses) about cross-site cookies', () => {
    expect(check({ COOKIE_SECURE: 'false' }).problems.join(' ')).toMatch(/COOKIE_SECURE/);
    const cross = check({ COOKIE_CROSS_SITE: true, COOKIE_SECURE: 'true' });
    expect(cross.problems).toEqual([]);
    expect(cross.warnings.join(' ')).toMatch(/third-party cookies/);
  });

  it('reports every problem at once', () => {
    const report = check({ STORAGE_DRIVER: 'local', COOKIE_SECURE: 'false', APP_URL: 'http://localhost:5173' });
    expect(report.problems.length).toBeGreaterThanOrEqual(3);
  });
});
