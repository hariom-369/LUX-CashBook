import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../lib/logger.js';

let memoryServer: { stop: () => Promise<unknown> } | null = null;

/**
 * True when the connected deployment supports multi-document transactions
 * (i.e. it is a replica set or a sharded cluster). A standalone `mongod` does not,
 * so `withTransaction()` falls back to sequential writes — see `lib/transaction.ts`.
 */
let transactionsSupported = false;

export function supportsTransactions(): boolean {
  return transactionsSupported;
}

async function resolveUri(): Promise<string> {
  if (env.MONGODB_URI) return env.MONGODB_URI;

  if (env.isProduction) {
    // env.ts already refuses to boot in this state; belt and braces.
    throw new Error('MONGODB_URI is required in production.');
  }

  // Development / test convenience: spin up a real MongoDB in-process. It is a
  // single-node *replica set*, so transactions behave exactly as they will in
  // production rather than silently taking the fallback path.
  logger.warn('MONGODB_URI not set — starting an in-process MongoDB (development only).');
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  memoryServer = replSet;
  return replSet.getUri(env.MONGODB_DB_NAME);
}

async function detectTransactionSupport(): Promise<void> {
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) return;
    const info = (await admin.command({ hello: 1 })) as { setName?: string; msg?: string };
    transactionsSupported = Boolean(info.setName) || info.msg === 'isdbgrid';
  } catch {
    transactionsSupported = false;
  }

  if (!transactionsSupported) {
    logger.warn(
      'MongoDB deployment does not support multi-document transactions (standalone server). ' +
        'Multi-step financial writes will run sequentially with compensating rollback. ' +
        'Use a replica set or MongoDB Atlas in production.',
    );
  }
}

export async function connectDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;

  const uri = await resolveUri();

  mongoose.set('strictQuery', true);
  // Surface accidental full-collection scans during development.
  if (env.isDevelopment) mongoose.set('debug', false);

  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));

  await mongoose.connect(uri, {
    dbName: env.MONGODB_DB_NAME,
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    minPoolSize: 2,
    // Reads must never observe a half-applied transfer.
    readConcern: { level: 'local' },
    writeConcern: { w: 'majority' },
  });

  await detectTransactionSupport();

  logger.info(
    { db: mongoose.connection.name, transactions: transactionsSupported },
    'MongoDB connected',
  );
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.connection.close();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

/** Build every index declared on every registered model. Called once at boot. */
export async function syncIndexes(): Promise<void> {
  const names = Object.keys(mongoose.models);
  await Promise.all(
    names.map(async (name) => {
      try {
        await mongoose.models[name]!.syncIndexes();
      } catch (err) {
        logger.error({ err, model: name }, 'Failed to sync indexes');
      }
    }),
  );
  logger.info({ models: names.length }, 'Indexes synchronised');
}
