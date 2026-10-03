import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Workspace, WorkspaceMember } from '../src/models/index.js';
import { runBackfill } from '../src/scripts/backfillWorkspaceMembers.js';

/**
 * Phase 9 migration (docs/ROADMAP_PHASE9_NOTES.md): every workspace that
 * predates household sharing needs an owner `WorkspaceMember` row, or its
 * own owner would be locked out once `requireWorkspace` checks membership
 * instead of `Workspace.userId`.
 */
describe('backfillWorkspaceMembers', () => {
  it('creates an owner membership for a legacy workspace with none', async () => {
    const userId = new Types.ObjectId();
    const workspace = await Workspace.create({ userId, name: 'Legacy', mode: 'personal', currency: 'INR', isDefault: true });

    const dryRun = await runBackfill(false);
    expect(dryRun.missing).toBe(1);
    expect(await WorkspaceMember.countDocuments({ workspaceId: workspace._id })).toBe(0);

    const applied = await runBackfill(true);
    expect(applied.missing).toBe(1);
    expect(applied.created).toBe(1);

    const membership = await WorkspaceMember.findOne({ workspaceId: workspace._id, userId }).lean();
    expect(membership?.role).toBe('owner');
    expect(membership?.isDefault).toBe(true);
  });

  it('is idempotent — running it again touches nothing', async () => {
    const userId = new Types.ObjectId();
    await Workspace.create({ userId, name: 'Legacy 2', mode: 'personal', currency: 'INR' });

    await runBackfill(true);
    const second = await runBackfill(true);
    expect(second.missing).toBe(0);
    expect(await WorkspaceMember.countDocuments({ userId })).toBe(1);
  });

  it('leaves a workspace that already has its owner membership untouched', async () => {
    const userId = new Types.ObjectId();
    const workspace = await Workspace.create({ userId, name: 'Already migrated', mode: 'personal', currency: 'INR' });
    await WorkspaceMember.create({ workspaceId: workspace._id, userId, role: 'owner', isDefault: true, joinedAt: new Date() });

    const result = await runBackfill(true);
    expect(result.missing).toBe(0);
    expect(await WorkspaceMember.countDocuments({ workspaceId: workspace._id })).toBe(1);
  });
});
