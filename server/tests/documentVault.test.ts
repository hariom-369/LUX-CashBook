import { beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { addDays } from '@khata/shared';
import { as, createTestUser, realImage, type TestUser } from './helpers.js';
import { Attachment } from '../src/models/index.js';
import { purgeDeletedAttachments } from '../src/modules/attachments/attachment.service.js';
import { syncDocumentReminders } from '../src/modules/reminders/reminder.service.js';

/**
 * Document vault (docs/ROADMAP_PHASE6_NOTES.md): standalone documents —
 * warranties, insurance, rent agreements — alongside the pre-existing
 * transaction-receipt attachments, plus restore (deliberately changes the
 * old "delete purges the file immediately" behaviour to a 30-day grace
 * window) and expiry reminders.
 */

let user: TestUser;

function scopeOf(u: TestUser) {
  return {
    userId: Types.ObjectId.createFromHexString(u.userId),
    workspaceId: Types.ObjectId.createFromHexString(u.workspaceId),
    currency: 'INR',
    mode: 'personal' as const,
    role: 'owner' as const,
    hiddenAccountIds: [],
  };
}

let fakeJpeg: Buffer; // a genuine (tiny) JPEG, built once in beforeEach

beforeEach(async () => {
  fakeJpeg = await realImage('jpeg');
  user = await createTestUser();
});

async function uploadDocument(overrides: Partial<{ title: string; docType: string; expiryDate: string; tags: string }> = {}) {
  let req = as(user)
    .post('/api/v1/attachments')
    .field('docType', overrides.docType ?? 'warranty')
    .field('title', overrides.title ?? 'Fridge warranty');
  if (overrides.expiryDate) req = req.field('expiryDate', overrides.expiryDate);
  if (overrides.tags) req = req.field('tags', overrides.tags);
  return req.attach('file', fakeJpeg, { filename: 'warranty.jpg', contentType: 'image/jpeg' }).expect(201);
}

describe('document vault', () => {
  it('uploads a standalone document with no transaction, and finds it by type, title search and tag', async () => {
    const uploaded = await uploadDocument({ tags: 'kitchen,appliance' });
    expect(uploaded.body.data.docType).toBe('warranty');
    expect(uploaded.body.data.transactionId).toBeUndefined();
    expect(uploaded.body.data.tags).toEqual(['kitchen', 'appliance']);

    const byType = await as(user).get('/api/v1/attachments?docType=warranty').expect(200);
    expect(byType.body.data.map((d: { id: string }) => d.id)).toContain(uploaded.body.data.id);

    const bySearch = await as(user).get('/api/v1/attachments?search=fridge').expect(200);
    expect(bySearch.body.data.map((d: { id: string }) => d.id)).toContain(uploaded.body.data.id);

    const byTag = await as(user).get('/api/v1/attachments?tags=kitchen').expect(200);
    expect(byTag.body.data.map((d: { id: string }) => d.id)).toContain(uploaded.body.data.id);

    const otherType = await as(user).get('/api/v1/attachments?docType=insurance').expect(200);
    expect(otherType.body.data.map((d: { id: string }) => d.id)).not.toContain(uploaded.body.data.id);
  });

  it('restores a deleted document within the grace window', async () => {
    const uploaded = await uploadDocument();
    const id = uploaded.body.data.id;

    await as(user).delete(`/api/v1/attachments/${id}`).expect(200);
    let list = await as(user).get('/api/v1/attachments').expect(200);
    expect(list.body.data.map((d: { id: string }) => d.id)).not.toContain(id);

    const withDeleted = await as(user).get('/api/v1/attachments?includeDeleted=true').expect(200);
    const deletedRow = withDeleted.body.data.find((d: { id: string }) => d.id === id);
    expect(deletedRow.deletedAt).toBeTruthy();

    await as(user).post(`/api/v1/attachments/${id}/restore`).expect(200);
    list = await as(user).get('/api/v1/attachments').expect(200);
    expect(list.body.data.map((d: { id: string }) => d.id)).toContain(id);

    await as(user).get(`/api/v1/attachments/${id}/download`).expect(200);
  });

  it('purges a document only after it has been deleted for more than 30 days', async () => {
    const uploaded = await uploadDocument();
    const id = uploaded.body.data.id;
    await as(user).delete(`/api/v1/attachments/${id}`).expect(200);

    // Still within the grace window — nothing purged.
    expect(await purgeDeletedAttachments(new Date())).toBe(0);
    expect(await Attachment.findById(id).lean()).not.toBeNull();

    // Backdate the deletion past the retention window and purge again.
    await Attachment.updateOne({ _id: id }, { $set: { deletedAt: addDays(new Date(), -31) } });
    const purged = await purgeDeletedAttachments(new Date());
    expect(purged).toBe(1);
    expect(await Attachment.findById(id).lean()).toBeNull();
  });

  it('never leaks another workspace\'s documents, and refuses a cross-workspace restore', async () => {
    const uploaded = await uploadDocument();
    await as(user).delete(`/api/v1/attachments/${uploaded.body.data.id}`).expect(200);

    const other = await createTestUser();
    expect((await as(other).get('/api/v1/attachments').expect(200)).body.data).toEqual([]);
    await as(other).post(`/api/v1/attachments/${uploaded.body.data.id}/restore`).expect(404);
  });
});

describe('document expiry reminders', () => {
  it('raises a reminder for a document nearing its expiry, and retires it once the document is deleted', async () => {
    const uploaded = await uploadDocument({ expiryDate: addDays(new Date(), 10).toISOString() });
    await syncDocumentReminders(scopeOf(user));

    let reminders = await as(user).get('/api/v1/reminders').expect(200);
    expect(reminders.body.data.map((r: { type: string }) => r.type)).toContain('document_expiry');

    await as(user).delete(`/api/v1/attachments/${uploaded.body.data.id}`).expect(200);
    await syncDocumentReminders(scopeOf(user));

    reminders = await as(user).get('/api/v1/reminders').expect(200);
    expect(reminders.body.data.map((r: { type: string }) => r.type)).not.toContain('document_expiry');
  });
});
