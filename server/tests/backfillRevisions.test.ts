import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { runBackfill } from '../src/scripts/backfillRevisions.js';
import { Account, Person } from '../src/models/index.js';

/**
 * `runBackfill` against the suite's real in-process MongoDB (tests/setup.ts) —
 * the same database every other test in this suite runs against, not a mock.
 */
describe('rev backfill script', () => {
  async function legacyAccount(name: string) {
    // Bypasses the schema's `rev` default, simulating a document written before
    // Phase 1 added the field — a normal `Account.create` would already set it.
    const result = await Account.collection.insertOne({
      userId: new Types.ObjectId(),
      workspaceId: new Types.ObjectId(),
      name,
      type: 'cash',
      openingBalanceMinor: 0,
      openingDate: new Date(),
      currency: 'INR',
      color: '#000000',
      icon: 'Circle',
      isActive: true,
      isLiability: false,
      blockNegativeBalance: false,
      excludeFromTotals: false,
      sortOrder: 0,
      isPettyCash: false,
      deletedAt: null,
      deletedBy: null,
      cachedBalanceMinor: 0,
      cachedBalanceAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return result.insertedId;
  }

  it('a dry run reports what is missing and writes nothing', async () => {
    const id = await legacyAccount('Legacy A');

    const results = await runBackfill(false);
    const accountRow = results.find((r) => r.model === 'Account')!;
    expect(accountRow.missing).toBeGreaterThanOrEqual(1);
    expect(accountRow.modified).toBeUndefined();

    const stillRaw = await Account.collection.findOne({ _id: id });
    expect(stillRaw).not.toHaveProperty('rev');
  });

  it('--apply sets rev: 0 on every document missing it, across models', async () => {
    const accountId = await legacyAccount('Legacy B');
    const personResult = await Person.collection.insertOne({
      userId: new Types.ObjectId(),
      workspaceId: new Types.ObjectId(),
      name: 'Legacy person',
      relationship: 'friend',
      tags: [],
      openingBalanceMinor: 0,
      openingDate: new Date(),
      cachedBalanceMinor: 0,
      cachedBalanceAt: new Date(),
      isArchived: false,
      deletedAt: null,
      deletedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const results = await runBackfill(true);
    const accountRow = results.find((r) => r.model === 'Account')!;
    expect(accountRow.modified).toBeGreaterThanOrEqual(1);

    expect((await Account.collection.findOne({ _id: accountId }))!.rev).toBe(0);
    expect((await Person.collection.findOne({ _id: personResult.insertedId }))!.rev).toBe(0);
  });

  it('is idempotent — a second run finds nothing left to do', async () => {
    await legacyAccount('Legacy C');
    await runBackfill(true);

    const second = await runBackfill(true);
    const accountRow = second.find((r) => r.model === 'Account')!;
    expect(accountRow.missing).toBe(0);
    expect(accountRow.modified).toBeUndefined();
  });

  it('never changes rev on a document that already has one', async () => {
    const created = await Account.create({
      userId: new Types.ObjectId(),
      workspaceId: new Types.ObjectId(),
      name: 'Modern account',
      type: 'cash',
      openingBalanceMinor: 0,
    });
    await Account.updateOne({ _id: created._id }, { $set: { rev: 3 } });

    await runBackfill(true);

    expect((await Account.findById(created._id))!.rev).toBe(3);
  });
});
