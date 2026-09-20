import { afterAll, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

// Attachment tests exercise the real local storage driver, which writes to
// disk — pointed at a dedicated scratch directory (never the default
// `./storage`) so test runs never leave files behind in the actual project tree.
const TEST_STORAGE_DIR = path.resolve(process.cwd(), '.test-storage');

/**
 * Test database.
 *
 * A single-node *replica set* rather than a standalone `mongod`, so the tests
 * exercise the same multi-document transaction path production uses. Testing
 * against a standalone would quietly take the compensating-rollback fallback and
 * leave the real code path unverified.
 */
let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-that-is-at-least-32-chars-long';
  process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-that-is-at-least-32-chars-long';
  process.env.STORAGE_DIR = TEST_STORAGE_DIR;
  await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });

  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  await mongoose.connect(replSet.getUri('khata_test'), { dbName: 'khata_test' });

  // Import after connecting so every model registers against this connection.
  await import('../src/models/index.js');
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes().catch(() => undefined)),
  );
}, 120_000);

/**
 * Each test starts from an empty database.
 *
 * Financial assertions are about exact totals, so a row left behind by a previous
 * test would not merely be untidy — it would change the answer.
 */
beforeEach(async () => {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.close();
  await replSet?.stop();
  await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
});
