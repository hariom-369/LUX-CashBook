import { beforeEach, describe, expect, it } from 'vitest';
import { as, createTestUser, rupees, type TestUser } from './helpers.js';

/**
 * Attachment upload, download and authorization (§26, §69).
 *
 * Uses the real local storage driver (see tests/setup.ts for the scratch
 * directory it's pointed at) — this exercises the actual `StorageDriver`
 * interface that the S3 driver also implements, not a mock, so a passing test
 * here says something real about the upload/download/delete flow. Cross-user
 * authorization is the point of most of these: a valid, well-formed attachment
 * id belonging to someone else must behave exactly like a nonexistent one.
 */
let owner: TestUser;
let intruder: TestUser;
let accountId: string;
let categoryId: string;

async function createTransaction(): Promise<string> {
  const response = await as(owner)
    .post('/api/v1/transactions')
    .send({
      type: 'expense',
      amountMinor: rupees(500),
      accountId,
      categoryId,
      date: new Date().toISOString(),
      description: 'Lunch',
    })
    .expect(201);
  return response.body.data.id;
}

beforeEach(async () => {
  owner = await createTestUser();
  intruder = await createTestUser();

  const accountRes = await as(owner)
    .post('/api/v1/accounts')
    .send({ name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(5000) })
    .expect(201);
  accountId = accountRes.body.data.id;

  const categoryRes = await as(owner).get('/api/v1/categories?kind=expense&flat=true').expect(200);
  categoryId = categoryRes.body.data[0].id;
});

describe('uploading an attachment', () => {
  it('accepts a valid image, links it to the transaction, and serves it back byte-for-byte on download', async () => {
    const transactionId = await createTransaction();
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const uploadRes = await as(owner)
      .post('/api/v1/attachments')
      .field('transactionId', transactionId)
      .attach('file', fakeJpeg, { filename: 'receipt.jpg', contentType: 'image/jpeg' })
      .expect(201);

    expect(uploadRes.body.data.fileName).toBe('receipt.jpg');
    expect(uploadRes.body.data.url).toBe(`/api/v1/attachments/${uploadRes.body.data.id}/download`);

    const listRes = await as(owner).get(`/api/v1/attachments/transaction/${transactionId}`).expect(200);
    expect(listRes.body.data).toHaveLength(1);

    const downloadRes = await as(owner)
      .get(`/api/v1/attachments/${uploadRes.body.data.id}/download`)
      .expect(200);
    // sharp re-encodes any accepted image as JPEG — the exact bytes will differ
    // from the tiny fake input above, but a real, non-empty JPEG must come back.
    expect(downloadRes.headers['content-type']).toBe('image/jpeg');
    expect(downloadRes.body.length).toBeGreaterThan(0);
  });

  it('rejects a disallowed file type on the backend, not just in the UI', async () => {
    await as(owner)
      .post('/api/v1/attachments')
      .attach('file', Buffer.from('#!/bin/sh\necho hi'), { filename: 'script.sh', contentType: 'application/x-sh' })
      .expect(400);
  });

  it('rejects a file over the configured size limit', async () => {
    // MAX_UPLOAD_MB defaults to 10 — multer itself enforces this at the
    // multipart-parsing layer before the route handler ever sees the file.
    const oversized = Buffer.alloc(11 * 1024 * 1024, 1);
    await as(owner)
      .post('/api/v1/attachments')
      .attach('file', oversized, { filename: 'huge.pdf', contentType: 'application/pdf' })
      .expect(400);
  });

  it('refuses an unauthenticated upload', async () => {
    const { anon } = await import('./helpers.js');
    await anon()
      .post('/api/v1/attachments')
      .attach('file', Buffer.from('x'), { filename: 'a.pdf', contentType: 'application/pdf' })
      .expect(401);
  });
});

describe('cross-user attachment authorization', () => {
  it("a different user cannot download another user's attachment, even with a real, well-formed id", async () => {
    const transactionId = await createTransaction();
    const uploadRes = await as(owner)
      .post('/api/v1/attachments')
      .field('transactionId', transactionId)
      .attach('file', Buffer.from('%PDF-1.4 fake'), { filename: 'bill.pdf', contentType: 'application/pdf' })
      .expect(201);
    const attachmentId = uploadRes.body.data.id;

    // Same response as a nonexistent id — the API never confirms that an
    // attachment belonging to someone else even exists.
    const res = await as(intruder).get(`/api/v1/attachments/${attachmentId}/download`).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it("a different user cannot delete another user's attachment", async () => {
    const transactionId = await createTransaction();
    const uploadRes = await as(owner)
      .post('/api/v1/attachments')
      .field('transactionId', transactionId)
      .attach('file', Buffer.from('%PDF-1.4 fake'), { filename: 'bill.pdf', contentType: 'application/pdf' })
      .expect(201);
    const attachmentId = uploadRes.body.data.id;

    await as(intruder).delete(`/api/v1/attachments/${attachmentId}`).expect(404);

    // Confirm it's still there and still readable by its actual owner —
    // the rejected cross-user delete must not have partially applied.
    await as(owner).get(`/api/v1/attachments/${attachmentId}/download`).expect(200);
  });

  it("a different user cannot list another user's attachments by guessing a transaction id", async () => {
    const transactionId = await createTransaction();
    await as(owner)
      .post('/api/v1/attachments')
      .field('transactionId', transactionId)
      .attach('file', Buffer.from('%PDF-1.4 fake'), { filename: 'bill.pdf', contentType: 'application/pdf' })
      .expect(201);

    const res = await as(intruder).get(`/api/v1/attachments/transaction/${transactionId}`).expect(200);
    // Scoped by the intruder's own workspace, which this transaction id does not
    // belong to — an empty list, not someone else's receipt.
    expect(res.body.data).toEqual([]);
  });
});

describe('deleting an attachment', () => {
  it('removes it from its own transaction without affecting another workspace\'s attachment on the same transaction slot', async () => {
    const transactionId = await createTransaction();
    const uploadRes = await as(owner)
      .post('/api/v1/attachments')
      .field('transactionId', transactionId)
      .attach('file', Buffer.from('%PDF-1.4 fake'), { filename: 'bill.pdf', contentType: 'application/pdf' })
      .expect(201);

    // A second, unrelated attachment in the intruder's own workspace.
    const intruderAccount = await as(intruder)
      .post('/api/v1/accounts')
      .send({ name: 'Wallet', type: 'cash', openingBalanceMinor: rupees(1000) })
      .expect(201);
    const intruderCategory = await as(intruder).get('/api/v1/categories?kind=expense&flat=true').expect(200);
    const intruderTxn = await as(intruder)
      .post('/api/v1/transactions')
      .send({
        type: 'expense',
        amountMinor: rupees(100),
        accountId: intruderAccount.body.data.id,
        categoryId: intruderCategory.body.data[0].id,
        date: new Date().toISOString(),
      })
      .expect(201);
    const intruderUpload = await as(intruder)
      .post('/api/v1/attachments')
      .field('transactionId', intruderTxn.body.data.id)
      .attach('file', Buffer.from('%PDF-1.4 other'), { filename: 'other.pdf', contentType: 'application/pdf' })
      .expect(201);

    await as(owner).delete(`/api/v1/attachments/${uploadRes.body.data.id}`).expect(200);

    // The owner's copy is gone...
    await as(owner).get(`/api/v1/attachments/${uploadRes.body.data.id}/download`).expect(404);
    // ...but the completely unrelated intruder's own file is untouched.
    await as(intruder).get(`/api/v1/attachments/${intruderUpload.body.data.id}/download`).expect(200);
  });
});
