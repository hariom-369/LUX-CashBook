import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Redaction is not optional here: this is a finance API, and an access log that
 * leaks a password, a token or a full account number is a breach, not a debug aid.
 */
const redact = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    'password',
    'currentPassword',
    'newPassword',
    'confirmPassword',
    'pin',
    'token',
    'accessToken',
    'refreshToken',
    '*.password',
    '*.token',
    'body.password',
    'body.pin',
  ],
  censor: '[redacted]',
};

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact,
  base: { service: 'khata-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(env.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
        },
      }),
});

export type Logger = typeof logger;
