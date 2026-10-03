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

  it('requires SMTP and a real sender address', () => {
    expect(check({ SMTP_HOST: undefined }).problems.join(' ')).toMatch(/SMTP_HOST/);
    expect(check({ SMTP_PASS: undefined }).problems.join(' ')).toMatch(/SMTP_PASS/);
    expect(check({ mailFromExplicit: false }).problems.join(' ')).toMatch(/MAIL_FROM/);
    expect(check({ SMTP_USER: undefined, SMTP_PASS: undefined }).problems).toEqual([]); // an unauthenticated relay
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
    const report = check({ STORAGE_DRIVER: 'local', SMTP_HOST: undefined, APP_URL: 'http://localhost:5173' });
    expect(report.problems.length).toBeGreaterThanOrEqual(3);
  });
});
