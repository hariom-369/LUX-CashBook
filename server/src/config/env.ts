import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import crypto from 'node:crypto';

loadDotenv();

/**
 * Environment contract.
 *
 * The process refuses to start with an invalid configuration rather than failing
 * later in a request — a finance server booting with a missing JWT secret is worse
 * than a server that does not boot.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),

  /** Base URL of the API itself, used to build absolute links (attachments, emails). */
  API_URL: z.string().url().default('http://localhost:4000'),
  /** Where the browser app lives — used for CORS and for links inside emails. */
  APP_URL: z.string().url().default('http://localhost:5173'),
  /** Extra allowed origins, comma separated. */
  CORS_ORIGINS: z.string().optional(),

  /**
   * Leave empty in development and the server starts a throwaway in-process MongoDB
   * (see `config/db.ts`) so a fresh clone runs with no external services.
   */
  MONGODB_URI: z.string().optional(),
  MONGODB_DB_NAME: z.string().default('khata'),

  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  JWT_REFRESH_SECRET: z.string().min(32).optional(),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  /** Cookie settings for the refresh token. */
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: z
    .enum(['true', 'false', 'auto'])
    .default('auto')
    .transform((v) => v),
  /**
   * Set to true only when the frontend and the API are served from different
   * sites (e.g. a Vercel frontend calling a Render API) — the case the browser
   * calls "cross-site" and treats very differently from two subdomains of the
   * same registrable domain. A cross-site refresh cookie needs `SameSite=None`,
   * which in turn requires `Secure`, or the browser silently refuses to store or
   * send it at all — see the boot-time check below for what enforces that
   * pairing. Defaults to false, which keeps today's `SameSite=Strict` behaviour
   * for anyone deploying the frontend and API under one domain.
   */
  COOKIE_CROSS_SITE: z.coerce.boolean().default(false),

  /** SMTP — when absent, emails are logged to the console instead of sent. */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),
  MAIL_FROM: z.string().default('Khata <no-reply@khata.app>'),

  /** File storage: `local` writes under STORAGE_DIR; `s3` uses the S3 adapter. */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().positive().default(15),
  RATE_LIMIT_MAX: z.coerce.number().positive().default(600),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().positive().default(20),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Run recurring-transaction and reminder processing inside this process. */
  ENABLE_SCHEDULER: z.coerce.boolean().default(true),
  /** Allow `POST /api/v1/dev/*` helpers. Never enable in production. */
  ENABLE_DEV_ROUTES: z.coerce.boolean().default(false),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\nInvalid environment configuration:\n${issues}\n\nSee server/.env.example.\n`);
  process.exit(1);
}

const raw = parsed.data;
const isProduction = raw.NODE_ENV === 'production';
const isTest = raw.NODE_ENV === 'test';

/**
 * Secrets are mandatory in production. Outside it we generate ephemeral ones so a
 * developer can run `npm run dev` immediately — with the side effect that restarting
 * the server invalidates existing tokens, which is exactly the right trade-off for dev.
 */
function requireSecret(value: string | undefined, name: string): string {
  if (value) return value;
  if (isProduction) {
    // eslint-disable-next-line no-console
    console.error(`\n${name} must be set in production. Generate one with:\n  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"\n`);
    process.exit(1);
  }
  return crypto.randomBytes(48).toString('base64url');
}

if (isProduction && !raw.MONGODB_URI) {
  // eslint-disable-next-line no-console
  console.error('\nMONGODB_URI must be set in production — the in-memory fallback is development only.\n');
  process.exit(1);
}

// A cross-site cookie without `Secure` is not a weaker cookie — browsers refuse
// to store or send `SameSite=None` at all unless `Secure` is also set, so this
// combination would not "mostly work," it would break every login silently in
// whichever browser enforces the pairing (all current major ones). Refusing to
// boot here surfaces that at deploy time instead of in a confused bug report.
if (raw.COOKIE_CROSS_SITE && raw.COOKIE_SECURE === 'false') {
  // eslint-disable-next-line no-console
  console.error(
    '\nCOOKIE_CROSS_SITE=true requires COOKIE_SECURE to be "true" or "auto" (never "false") — ' +
      'a cross-site cookie cannot work without Secure. See docs/DEPLOYMENT.md.\n',
  );
  process.exit(1);
}

export const env = {
  ...raw,
  isProduction,
  isTest,
  isDevelopment: raw.NODE_ENV === 'development',
  JWT_ACCESS_SECRET: requireSecret(raw.JWT_ACCESS_SECRET, 'JWT_ACCESS_SECRET'),
  JWT_REFRESH_SECRET: requireSecret(raw.JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET'),
  // `SameSite=None` mandates `Secure`, so cross-site mode also implies secure
  // cookies even if COOKIE_SECURE were left on "auto" outside production —
  // there is no real-world case where a cross-site cookie should be insecure.
  cookieSecure: raw.COOKIE_CROSS_SITE ? true : raw.COOKIE_SECURE === 'auto' ? isProduction : raw.COOKIE_SECURE === 'true',
  cookieSameSite: (raw.COOKIE_CROSS_SITE ? 'none' : 'strict') as 'none' | 'strict',
  corsOrigins: [
    raw.APP_URL,
    ...(raw.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? []),
  ],
  maxUploadBytes: raw.MAX_UPLOAD_MB * 1024 * 1024,
  refreshTokenTtlMs: raw.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
} as const;

export type Env = typeof env;
