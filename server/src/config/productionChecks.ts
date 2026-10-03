/**
 * What a production boot must have (docs/DEPLOYMENT.md). Pure, so it can be tested without starting the
 * server: `env.ts` calls it once and refuses to boot when it returns anything in `problems`.
 *
 * Each rule here is a failure that otherwise only shows up later, for a real user: receipts vanishing on
 * the next deploy (ephemeral disk), the first password-reset email failing at send time, cookies that
 * cannot be stored, links in emails pointing at localhost.
 */
export interface ProductionConfig {
  STORAGE_DRIVER: 'local' | 's3';
  ALLOW_LOCAL_STORAGE_IN_PRODUCTION: boolean;
  S3_BUCKET?: string;
  S3_REGION?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  SMTP_HOST?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  /** True only when MAIL_FROM was actually set, not left at the placeholder default. */
  mailFromExplicit: boolean;
  APP_URL: string;
  API_URL: string;
  COOKIE_CROSS_SITE: boolean;
  COOKIE_SECURE: 'true' | 'false' | 'auto';
}

export interface ProductionReport {
  problems: string[];
  warnings: string[];
}

const isLocalHost = (value: string): boolean => {
  try {
    const { hostname } = new URL(value);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.localhost');
  } catch {
    return false;
  }
};

export function checkProduction(c: ProductionConfig): ProductionReport {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (c.STORAGE_DRIVER === 'local') {
    if (!c.ALLOW_LOCAL_STORAGE_IN_PRODUCTION) {
      problems.push(
        'STORAGE_DRIVER=local keeps receipts and documents on the server disk, which most hosts (Render included) wipe on every deploy. ' +
          'Set STORAGE_DRIVER=s3 (see docs/DEPLOYMENT.md), or - only if a persistent disk is mounted at STORAGE_DIR - ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true.',
      );
    }
  } else {
    if (!c.S3_BUCKET) problems.push('STORAGE_DRIVER=s3 requires S3_BUCKET.');
    if (!c.S3_REGION) problems.push('STORAGE_DRIVER=s3 requires S3_REGION.');
    if (Boolean(c.S3_ACCESS_KEY_ID) !== Boolean(c.S3_SECRET_ACCESS_KEY)) {
      problems.push('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together (or both left out to use an IAM role).');
    }
  }

  if (!c.SMTP_HOST) {
    problems.push('SMTP_HOST must be set: without it password-reset and verification emails cannot be sent (see docs/DEPLOYMENT.md).');
  }
  if (c.SMTP_USER && !c.SMTP_PASS) problems.push('SMTP_USER is set without SMTP_PASS.');
  if (!c.mailFromExplicit) {
    problems.push('MAIL_FROM must be set to an address on a domain you have verified with your mail provider (the default is a placeholder).');
  }

  for (const [name, value] of [['APP_URL', c.APP_URL], ['API_URL', c.API_URL]] as const) {
    if (isLocalHost(value)) problems.push(`${name} still points at localhost; set it to the public https URL (it is used in CORS and in email links).`);
    else if (!value.startsWith('https://')) problems.push(`${name} must be an https:// URL in production.`);
  }
  if (c.COOKIE_SECURE === 'false') problems.push('COOKIE_SECURE=false would send the refresh cookie over plain HTTP; use "true" or "auto".');

  if (c.COOKIE_CROSS_SITE) {
    warnings.push(
      'COOKIE_CROSS_SITE=true relies on third-party cookies, which Safari and some Chrome settings block (token refresh then fails). ' +
        'Serve the app and the API from one parent domain (app.example.com + api.example.com) and leave it false.',
    );
  }
  return { problems, warnings };
}
