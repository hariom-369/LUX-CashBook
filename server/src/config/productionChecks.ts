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
  /** SMTP is optional: all of these matter only when SMTP_HOST is set. */
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_SECURE?: boolean;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  MAIL_FROM?: string;
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

const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$|^\[[0-9A-Fa-f:.]+\]$/;
/** `a@b.co` or `Name <a@b.co>`: one address, no control characters (a header-injection guard), nothing exotic. */
const MAIL_FROM = /^(?:[^<>@\r\n]+<)?[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+>?$/;

/**
 * SMTP is optional - without `SMTP_HOST` there is nothing to check and nothing is required. When it IS set, the
 * rest has to be coherent, so a typo fails at boot with the variable named rather than at the first email. Messages
 * name variables only; a credential is never echoed.
 */
export function checkSmtp(c: ProductionConfig, production: boolean): string[] {
  if (!c.SMTP_HOST) return [];
  const problems: string[] = [];
  if (!HOST.test(c.SMTP_HOST)) problems.push('SMTP_HOST must be a bare host name such as smtp.example.com (no scheme, path, port or spaces).');
  const port = c.SMTP_PORT ?? 587;
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push('SMTP_PORT must be a port number between 1 and 65535.');
  if (port === 465 && c.SMTP_SECURE === false) problems.push('SMTP_PORT=465 expects an implicit-TLS connection: set SMTP_SECURE=true (or use port 587 with SMTP_SECURE=false).');
  if ((port === 587 || port === 25) && c.SMTP_SECURE === true) problems.push(`SMTP_PORT=${port} upgrades with STARTTLS: set SMTP_SECURE=false (or use port 465 with SMTP_SECURE=true).`);
  if (Boolean(c.SMTP_USER) !== Boolean(c.SMTP_PASS)) problems.push('SMTP_USER and SMTP_PASS must be set together (or both left out for a relay without a login).');
  if (c.MAIL_FROM && c.mailFromExplicit && !MAIL_FROM.test(c.MAIL_FROM)) problems.push('MAIL_FROM must be an address such as no-reply@example.com or "Khata <no-reply@example.com>".');
  if (production && !c.mailFromExplicit) {
    problems.push('MAIL_FROM must be set to an address on a domain you have verified with your mail provider (the default is a placeholder).');
  }
  return problems;
}

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

  // SMTP is optional: only email verification and password reset need it. When it is configured, it must be coherent.
  problems.push(...checkSmtp(c, true));

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
