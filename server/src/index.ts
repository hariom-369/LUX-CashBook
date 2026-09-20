import type { Server } from 'node:http';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase, syncIndexes } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { startScheduler, stopScheduler } from './services/scheduler.service.js';

let server: Server | undefined;

async function start(): Promise<void> {
  await connectDatabase();
  await syncIndexes();

  const app = createApp();

  server = app.listen(env.PORT, env.HOST, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, app: env.APP_URL },
      `Khata API listening on ${env.API_URL}`,
    );
  });

  // Slow-loris protection: a client that opens a connection and dribbles headers
  // should not hold a socket indefinitely.
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 15_000;

  if (env.ENABLE_SCHEDULER) startScheduler();
}

/**
 * Shut down without cutting off work in flight.
 *
 * A financial write that is mid-flight when a deploy lands must be allowed to
 * finish: stop accepting new connections, drain the ones we have, then close the
 * database. The hard timeout exists only so a stuck socket cannot block a deploy
 * forever.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');

  const force = setTimeout(() => {
    logger.error('Graceful shutdown timed out — exiting');
    process.exit(1);
  }, 15_000);
  force.unref();

  try {
    stopScheduler();
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server!.close((err) => (err ? reject(err) : resolve())),
      );
    }
    await disconnectDatabase();
    clearTimeout(force);
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(signal));
}

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  void shutdown('uncaughtException');
});

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
