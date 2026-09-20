import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { requestId } from './middleware/context.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { forbidden } from './lib/errors.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { apiRouter } from './routes.js';
// Registering every model at boot lets `syncIndexes()` find them all.
import './models/index.js';

export function createApp(): Express {
  const app = express();

  // Behind a load balancer, `req.ip` must be the client address or rate limiting
  // buckets everyone together. Trust exactly one hop, not an arbitrary chain.
  app.set('trust proxy', env.isProduction ? 1 : false);
  app.disable('x-powered-by');

  app.use(requestId);

  app.use(
    helmet({
      // The API serves JSON and attachment downloads, never HTML that executes.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          sandbox: ['allow-downloads'],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: env.isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and non-browser callers (curl, mobile) send no Origin header.
        if (!origin) return callback(null, true);
        if (env.corsOrigins.includes(origin)) return callback(null, true);
        // A plain `Error` here would fall through `normalize()`'s catch-all and
        // get logged and reported as a 500 "something went wrong on our side" —
        // caught by manually testing this exact path against a non-whitelisted
        // origin. A rejected origin is an ordinary, expected 403, not a server
        // fault, and should neither alarm-level log nor look like a bug report.
        return callback(forbidden('Origin not allowed by CORS policy.'));
      },
      // Required for the httpOnly refresh cookie to travel at all.
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Workspace-Id', 'X-Request-Id', 'Idempotency-Key'],
      exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
      maxAge: 86_400,
    }),
  );

  // A financial payload is small. A 1 MB cap costs nothing and removes a whole
  // class of memory-exhaustion attempts. Uploads use their own multipart route.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  if (!env.isTest) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => (req as { id?: string }).id ?? 'unknown',
        // Health checks would otherwise dominate the log.
        autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
        customLogLevel: (_req, res, err) => {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
      }),
    );
  }

  app.use('/api', globalLimiter);
  app.use('/api/v1', apiRouter);

  app.get('/', (_req, res) => {
    res.json({ name: 'Khata API', version: 'v1', docs: '/api/v1/health' });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
