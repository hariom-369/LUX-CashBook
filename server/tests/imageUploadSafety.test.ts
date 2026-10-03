import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { Attachment } from '../src/models/index.js';
import { as, createTestUser, realImage, type TestUser } from './helpers.js';

/**
 * Uploaded images are decoded and re-encoded or they are refused - never stored as received
 * (docs/SECURITY.md, "Image uploads"). Each case below used to be kept verbatim under an image type.
 */

let user: TestUser;

beforeEach(async () => {
  user = await createTestUser();
});

const upload = (file: Buffer, filename: string, contentType: string) =>
  as(user).post('/api/v1/attachments').attach('file', file, { filename, contentType });

async function stored(): Promise<number> {
  return Attachment.countDocuments({ workspaceId: user.workspaceId });
}

describe('images that cannot be decoded are refused', () => {
  it('rejects a file that only starts like a JPEG', async () => {
    const res = await upload(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), 'receipt.jpg', 'image/jpeg').expect(400);
    expect(res.body.error.message).toMatch(/could not be read/);
    expect(await stored()).toBe(0);
  });

  it('rejects text, HTML and script content labelled as an image', async () => {
    for (const body of ['<script>alert(1)</script>', '<html><body onload=alert(1)>', 'just words', '']) {
      await upload(Buffer.from(body), 'x.jpg', 'image/jpeg').expect(400);
    }
    expect(await stored()).toBe(0);
  });

  it('rejects a truncated JPEG instead of keeping or half-rendering it', async () => {
    const full = await sharp(randomBytes(800 * 600 * 3), { raw: { width: 800, height: 600, channels: 3 } }).jpeg().toBuffer();
    await upload(full.subarray(0, Math.floor(full.length / 2)), 'half.jpg', 'image/jpeg').expect(400);
    await upload(full.subarray(0, 500), 'tiny.jpg', 'image/jpeg').expect(400);
    expect(await stored()).toBe(0);
  });

  it('rejects HEIC whether or not it can be decoded here', async () => {
    await upload(Buffer.from('....ftypheic....mif1heic'), 'IMG_0001.HEIC', 'image/heic').expect(400);
    // The declared type is not accepted at all any more.
    const res = await upload(await realImage('avif'), 'photo.heic', 'image/heic').expect(400);
    expect(res.body.error.message).toMatch(/Only JPEG, PNG, WebP/);
    expect(await stored()).toBe(0);
  });

  it('rejects an image whose real format is not on the list, whatever the upload claims', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    await upload(svg, 'logo.png', 'image/png').expect(400);
    await upload(await realImage('gif'), 'anim.png', 'image/png').expect(400);
    await upload(await realImage('avif'), 'photo.jpg', 'image/jpeg').expect(400);
    expect(await stored()).toBe(0);
  });

  it('never leaves a thumbnail behind for a refused image', async () => {
    await upload(Buffer.from('not an image'), 'x.jpg', 'image/jpeg').expect(400);
    expect(await Attachment.countDocuments({ thumbnailKey: { $ne: null } })).toBe(0);
  });
});

describe('images that can be decoded are always re-encoded', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('stores a %s as a bounded JPEG with a thumbnail, never the original bytes', async (format) => {
    const original = await realImage(format, 3000, 1500);
    const res = await upload(original, `scan.${format}`, `image/${format}`).expect(201);
    expect(res.body.data.mimeType).toBe('image/jpeg');
    expect(res.body.data.thumbnailUrl).toBeTruthy();
    const download = await as(user).get(res.body.data.url).expect(200);
    expect(Buffer.compare(download.body, original)).not.toBe(0);
    const meta = await sharp(download.body).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(2000);
    const thumb = await as(user).get(res.body.data.thumbnailUrl).expect(200);
    expect(Math.max((await sharp(thumb.body).metadata()).width ?? 0, 0)).toBeLessThanOrEqual(320);
  });

  it('applies the EXIF rotation and strips the metadata', async () => {
    const rotated = await sharp(await realImage('jpeg', 400, 200)).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const res = await upload(rotated, 'phone.jpg', 'image/jpeg').expect(201);
    const meta = await sharp((await as(user).get(res.body.data.url).expect(200)).body).metadata();
    expect(meta.height).toBeGreaterThan(meta.width ?? 0);
    expect(meta.exif).toBeUndefined();
  });

  it('trusts the decoded format, not the declared one (a PNG sent as image/jpeg is fine)', async () => {
    const res = await upload(await realImage('png'), 'scan.jpg', 'image/jpeg').expect(201);
    expect(res.body.data.mimeType).toBe('image/jpeg');
  });
});

describe('PDF documents', () => {
  it('accepts something that is a PDF', async () => {
    await upload(Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF'), 'bill.pdf', 'application/pdf').expect(201);
  });

  it('refuses anything else labelled as a PDF', async () => {
    const res = await upload(Buffer.from('<html><script>alert(1)</script></html>'), 'bill.pdf', 'application/pdf').expect(400);
    expect(res.body.error.message).toMatch(/not a valid PDF/);
    await upload(Buffer.from('MZ\x90\x00 executable'), 'bill.pdf', 'application/pdf').expect(400);
    expect(await stored()).toBe(0);
  });
});
