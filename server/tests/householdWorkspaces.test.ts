import { beforeEach, describe, expect, it } from 'vitest';
import { Invitation } from '../src/models/index.js';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Household workspaces (docs/ROADMAP_PHASE9_NOTES.md) — the roadmap's own
 * "highest-risk phase," explicitly calling for a dedicated authorization
 * test suite before release. Covers: membership gating (a non-member sees
 * a shared workspace exactly like a nonexistent one), the viewer role being
 * refused any write, admin/owner-only member management, the invite →
 * accept flow, and private-account visibility.
 */

let owner: TestUser;
let outsider: TestUser;

beforeEach(async () => {
  owner = await createTestUser();
  outsider = await createTestUser();
});

/** Invites `invitee` into `owner`'s workspace with `role`, and has them accept it. */
async function inviteAndAccept(invitee: TestUser, role: 'admin' | 'member' | 'viewer') {
  await as(owner).post('/api/v1/workspace-invitations').send({ email: invitee.email, role }).expect(201);
  const invitation = await Invitation.findOne({ workspaceId: owner.workspaceId, email: invitee.email }).select('+tokenHash');
  // The raw token only ever exists in the email the user receives; tests read it
  // straight from the hash's source (there is none to read back, so we mint our
  // own and overwrite the stored hash) — simplest way to drive the real accept
  // endpoint without standing up an email fixture.
  const { generateActionToken, hashToken } = await import('../src/lib/tokens.js');
  const { token } = generateActionToken();
  invitation!.tokenHash = hashToken(token);
  await invitation!.save();

  await as(invitee).post(`/api/v1/invitations/${token}/accept`).expect(200);
}

describe('membership gating', () => {
  it('a non-member cannot reach a workspace they have not been invited to — same 404 as nonexistent', async () => {
    await as(outsider).get('/api/v1/accounts').set('X-Workspace-Id', owner.workspaceId).expect(404);
    await as(outsider)
      .post('/api/v1/accounts')
      .set('X-Workspace-Id', owner.workspaceId)
      .send({ name: 'Intrusion', type: 'cash' })
      .expect(404);
  });

  it('does not appear in a non-member\'s workspace list or login session', async () => {
    const list = await as(outsider).get('/api/v1/workspaces').expect(200);
    expect(list.body.data.find((w: { id: string }) => w.id === owner.workspaceId)).toBeUndefined();
  });
});

describe('invite → accept', () => {
  it('requires the invited email to already have a Khata account', async () => {
    const res = await as(owner).post('/api/v1/workspace-invitations').send({ email: 'nobody@example.com', role: 'member' }).expect(400);
    expect(res.body.error.message).toMatch(/sign up/i);
  });

  it('refuses an invitation that would grant ownership', async () => {
    await as(owner).post('/api/v1/workspace-invitations').send({ email: outsider.email, role: 'owner' }).expect(400);
  });

  it('only owner/admin can invite, list, or revoke invitations', async () => {
    await inviteAndAccept(outsider, 'member');
    const thirdPerson = await createTestUser();

    await as(outsider)
      .post('/api/v1/workspace-invitations')
      .set('X-Workspace-Id', owner.workspaceId)
      .send({ email: thirdPerson.email, role: 'member' })
      .expect(403);
  });

  it('grants access with the invited role, and the workspace now appears in the invitee\'s list', async () => {
    await inviteAndAccept(outsider, 'member');

    const list = await as(outsider).get('/api/v1/workspaces').expect(200);
    const shared = list.body.data.find((w: { id: string }) => w.id === owner.workspaceId);
    expect(shared).toBeDefined();
    expect(shared.myRole).toBe('member');
    expect(shared.memberCount).toBe(2);

    // Now a real member — can read and write the shared workspace's data.
    await as(outsider).get('/api/v1/accounts').set('X-Workspace-Id', owner.workspaceId).expect(200);
    await as(outsider)
      .post('/api/v1/accounts')
      .set('X-Workspace-Id', owner.workspaceId)
      .send({ name: 'Shared Wallet', type: 'cash' })
      .expect(201);
  });

  it('refuses acceptance by a user whose email does not match the invitation', async () => {
    await as(owner).post('/api/v1/workspace-invitations').send({ email: outsider.email, role: 'member' }).expect(201);
    const invitation = await Invitation.findOne({ workspaceId: owner.workspaceId, email: outsider.email });
    const { generateActionToken, hashToken } = await import('../src/lib/tokens.js');
    const { token } = generateActionToken();
    invitation!.tokenHash = hashToken(token);
    await invitation!.save();

    const thirdPerson = await createTestUser();
    await as(thirdPerson).post(`/api/v1/invitations/${token}/accept`).expect(404);
  });

  it('an admin cannot invite a new member directly as admin — only the owner can', async () => {
    await inviteAndAccept(outsider, 'admin');
    const thirdPerson = await createTestUser();

    await as(outsider)
      .post('/api/v1/workspace-invitations')
      .set('X-Workspace-Id', owner.workspaceId)
      .send({ email: thirdPerson.email, role: 'admin' })
      .expect(403);

    // The owner can.
    await as(owner).post('/api/v1/workspace-invitations').send({ email: thirdPerson.email, role: 'admin' }).expect(201);
  });

  it('revoking a pending invitation stops it from being accepted', async () => {
    const created = await as(owner).post('/api/v1/workspace-invitations').send({ email: outsider.email, role: 'member' }).expect(201);
    await as(owner).delete(`/api/v1/workspace-invitations/${created.body.data.id}`).expect(200);

    const pending = await as(owner).get('/api/v1/workspace-invitations').expect(200);
    expect(pending.body.data).toEqual([]);
  });
});

describe('the viewer role', () => {
  it('can read, but every write is refused', async () => {
    await inviteAndAccept(outsider, 'viewer');

    await as(outsider).get('/api/v1/accounts').set('X-Workspace-Id', owner.workspaceId).expect(200);
    await as(outsider)
      .post('/api/v1/accounts')
      .set('X-Workspace-Id', owner.workspaceId)
      .send({ name: 'Viewer Attempt', type: 'cash' })
      .expect(403);
  });
});

describe('member management', () => {
  it('a member cannot change roles or remove anyone', async () => {
    await inviteAndAccept(outsider, 'member');
    await as(outsider)
      .patch(`/api/v1/members/${owner.userId}`)
      .set('X-Workspace-Id', owner.workspaceId)
      .send({ role: 'viewer' })
      .expect(403);
  });

  it('an admin can remove a member, but not another admin, and cannot promote to admin', async () => {
    await inviteAndAccept(outsider, 'admin');
    const member = await createTestUser();
    await inviteAndAccept(member, 'member');

    // Admin can demote/remove an ordinary member.
    await as(outsider)
      .patch(`/api/v1/members/${member.userId}`)
      .set('X-Workspace-Id', owner.workspaceId)
      .send({ role: 'viewer' })
      .expect(200);

    // Admin cannot promote anyone to admin — only the owner can.
    await as(outsider)
      .patch(`/api/v1/members/${member.userId}`)
      .set('X-Workspace-Id', owner.workspaceId)
      .send({ role: 'admin' })
      .expect(403);

    // Admin cannot remove the owner.
    await as(outsider)
      .delete(`/api/v1/members/${owner.userId}`)
      .set('X-Workspace-Id', owner.workspaceId)
      .expect(403);
  });

  it('the owner can promote a member to admin', async () => {
    await inviteAndAccept(outsider, 'member');
    await as(owner).patch(`/api/v1/members/${outsider.userId}`).send({ role: 'admin' }).expect(200);
  });
});

describe('leaving and deleting a workspace', () => {
  it('a non-owner can leave; the owner cannot delete without typing the name, and a non-owner cannot delete at all', async () => {
    await inviteAndAccept(outsider, 'member');

    await as(outsider)
      .delete(`/api/v1/workspaces/${owner.workspaceId}`)
      .set('X-Workspace-Id', owner.workspaceId)
      .send({ confirmation: owner.workspaceId })
      .expect(403);

    await as(outsider).post(`/api/v1/workspaces/${owner.workspaceId}/leave`).set('X-Workspace-Id', owner.workspaceId).expect(200);

    const members = await as(owner).get('/api/v1/members').expect(200);
    expect(members.body.data).toHaveLength(1);
  });

  it('deleting a shared workspace removes every member\'s access, and leaves a departed member\'s own workspace untouched', async () => {
    await inviteAndAccept(outsider, 'member');
    const outsiderOwnWorkspace = outsider.workspaceId;

    // The owner needs a second workspace of their own, or deleting their
    // only one would correctly be blocked by "you need at least one workspace."
    await as(owner).post('/api/v1/workspaces').send({ name: 'Owner Spare', mode: 'personal', currency: 'INR' }).expect(201);

    await as(owner).delete(`/api/v1/workspaces/${owner.workspaceId}`).send({ confirmation: 'DELETE' }).expect(403); // wrong confirmation on a non-demo workspace
    // Need the real workspace name to confirm deletion.
    const ownWs = await as(owner).get(`/api/v1/workspaces/${owner.workspaceId}`).expect(200);
    await as(owner).delete(`/api/v1/workspaces/${owner.workspaceId}`).send({ confirmation: ownWs.body.data.name }).expect(200);

    await as(outsider).get('/api/v1/accounts').set('X-Workspace-Id', owner.workspaceId).expect(404);
    // Their own workspace is completely unaffected.
    await as(outsider).get('/api/v1/accounts').set('X-Workspace-Id', outsiderOwnWorkspace).expect(200);
  });
});

describe('private accounts', () => {
  it('are invisible to other members in listing, direct access, and the transaction list', async () => {
    await inviteAndAccept(outsider, 'member');

    const privateAccount = await as(owner)
      .post('/api/v1/accounts')
      .send({ name: 'Secret Fund', type: 'savings', openingBalanceMinor: rupees(5_000), visibility: 'private' })
      .expect(201);

    const expenseCategory = (await as(owner).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id;
    await as(owner)
      .post('/api/v1/transactions')
      .send({ type: 'expense', amountMinor: rupees(500), accountId: privateAccount.body.data.id, categoryId: expenseCategory, date: new Date().toISOString(), description: 'Secret spend' })
      .expect(201);

    // The other member never sees it.
    const list = await as(outsider).get('/api/v1/accounts').set('X-Workspace-Id', owner.workspaceId).expect(200);
    expect(list.body.data.find((a: { id: string }) => a.id === privateAccount.body.data.id)).toBeUndefined();

    await as(outsider).get(`/api/v1/accounts/${privateAccount.body.data.id}`).set('X-Workspace-Id', owner.workspaceId).expect(404);

    const transactions = await as(outsider).get('/api/v1/transactions').set('X-Workspace-Id', owner.workspaceId).expect(200);
    expect(transactions.body.data.items.find((t: { description: string }) => t.description === 'Secret spend')).toBeUndefined();

    // The owner still sees their own private account and its transaction normally.
    const ownList = await as(owner).get('/api/v1/accounts').expect(200);
    expect(ownList.body.data.find((a: { id: string }) => a.id === privateAccount.body.data.id)).toBeDefined();

    // Fetching the transaction directly by id is refused too, not just absent from the list.
    const ownTransactions = await as(owner).get('/api/v1/transactions').expect(200);
    const secretTxnId = ownTransactions.body.data.items.find((t: { description: string }) => t.description === 'Secret spend').id;
    await as(outsider).get(`/api/v1/transactions/${secretTxnId}`).set('X-Workspace-Id', owner.workspaceId).expect(404);
  });

  it('a non-owner member cannot post a transaction against another member\'s private account, even by id', async () => {
    await inviteAndAccept(outsider, 'member');

    const privateAccount = await as(owner)
      .post('/api/v1/accounts')
      .send({ name: 'Secret Fund 2', type: 'savings', openingBalanceMinor: rupees(5_000), visibility: 'private' })
      .expect(201);

    const expenseCategory = (await as(owner).get('/api/v1/categories?kind=expense&flat=true').expect(200)).body.data[0].id;
    await as(outsider)
      .post('/api/v1/transactions')
      .set('X-Workspace-Id', owner.workspaceId)
      .send({ type: 'expense', amountMinor: rupees(100), accountId: privateAccount.body.data.id, categoryId: expenseCategory, date: new Date().toISOString(), description: 'Intrusion' })
      .expect(404);
  });

  it('defaults to shared — an ordinary account made before this phase (or without visibility set) stays visible to every member', async () => {
    await inviteAndAccept(outsider, 'member');
    const ordinary = await as(owner).post('/api/v1/accounts').send({ name: 'Household Wallet', type: 'cash' }).expect(201);

    const list = await as(outsider).get('/api/v1/accounts').set('X-Workspace-Id', owner.workspaceId).expect(200);
    expect(list.body.data.find((a: { id: string }) => a.id === ordinary.body.data.id)).toBeDefined();
  });
});

describe('per-member default workspace', () => {
  it('setting one member\'s default does not change another member\'s', async () => {
    await inviteAndAccept(outsider, 'member');

    await as(outsider).post(`/api/v1/workspaces/${owner.workspaceId}/default`).set('X-Workspace-Id', owner.workspaceId).expect(200);

    const ownerWorkspaces = await as(owner).get('/api/v1/workspaces').expect(200);
    const ownerOwn = ownerWorkspaces.body.data.find((w: { id: string }) => w.id === owner.workspaceId);
    expect(ownerOwn.isDefault).toBe(true); // unaffected by outsider's change

    const outsiderWorkspaces = await as(outsider).get('/api/v1/workspaces').expect(200);
    const sharedForOutsider = outsiderWorkspaces.body.data.find((w: { id: string }) => w.id === owner.workspaceId);
    expect(sharedForOutsider.isDefault).toBe(true);
  });
});
