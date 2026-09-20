import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { badRequest, internal } from './errors.js';
import { logger } from './logger.js';

/**
 * File storage abstraction (§26).
 *
 * Business logic (attachment.service.ts) only ever calls `put`/`get`/`delete`/
 * `exists` on a `StorageDriver` — it never knows or cares whether a file physically
 * lives on local disk or in S3. That boundary is what let S3 support get added here
 * without touching a single line of the upload/download/delete flow, the routes, the
 * Attachment model, or the client.
 */
export interface StoredFile {
  key: string;
  sizeBytes: number;
}

export interface StorageDriver {
  put(key: string, data: Buffer): Promise<StoredFile>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /**
   * A short-lived, time-limited URL for reading this object directly from the
   * storage backend, bypassing the app server. Optional: the local driver has no
   * equivalent (there's nothing to hand a browser a direct URL to), so every
   * caller must treat this as "may be unavailable" rather than relying on it.
   * Not currently wired into any route — see docs/DEPLOYMENT.md's storage
   * section for why the app still proxies downloads through an authenticated
   * endpoint today, and when switching a given route to redirect here instead
   * would be worth doing.
   */
  presignedGetUrl?(key: string, expiresInSeconds: number): Promise<string>;
}

/**
 * A storage key is workspace/year/month/uuid.ext — scoped by workspace so a
 * directory listing alone reveals nothing, and time-bucketed so one workspace's
 * receipts don't pile ten thousand files into a single directory. Identical
 * scheme for both drivers, since it works equally well as a filesystem path and
 * as an S3 object key.
 */
export function buildStorageKey(workspaceId: string, originalName: string): string {
  const ext = sanitizeExtension(originalName);
  const now = new Date();
  const id = crypto.randomUUID();
  return `${workspaceId}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${id}${ext}`;
}

function sanitizeExtension(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  // Only extensions we actually accept ever reach here (validated by the upload
  // route's mime allowlist), but re-validate the shape defensively — an
  // extension is about to become part of a filesystem path or object key.
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '';
}

class LocalStorageDriver implements StorageDriver {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    // Defence in depth against path traversal: resolve and re-check the key is
    // still inside the storage root, even though `buildStorageKey` never
    // produces `..` segments itself.
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep) && full !== this.root) {
      throw badRequest('Invalid storage key.');
    }
    return full;
  }

  async put(key: string, data: Buffer): Promise<StoredFile> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return { key, sizeBytes: data.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

export interface S3DriverConfig {
  bucket: string;
  region: string;
  /** Only set for an S3-compatible non-AWS endpoint (R2, MinIO, Spaces). */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * S3 (or any S3-compatible) object storage.
 *
 * Every object is written with server-side encryption and no ACL — the bucket
 * itself must block public access (documented in docs/DEPLOYMENT.md; this driver
 * has no way to enforce a bucket policy from inside the app, only to avoid ever
 * requesting public access on a per-object basis). Every read the app currently
 * performs still goes through `readAttachmentFile`/`readThumbnail`, which is only
 * reachable after the same workspace-ownership check as the local driver — so
 * moving the bytes to S3 changes nothing about who can reach them.
 */
class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3DriverConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      // `forcePathStyle` is required for most S3-compatible services (MinIO, R2)
      // when a custom endpoint is given; real AWS S3 ignores it either way.
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, data: Buffer): Promise<StoredFile> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: data,
          ServerSideEncryption: 'AES256',
          // Deliberately no ACL set — the bucket's own "block all public access"
          // setting is what keeps every object private, not a per-request flag
          // that a future code change could accidentally omit or invert.
        }),
      );
      return { key, sizeBytes: data.byteLength };
    } catch (err) {
      logger.error({ err, key }, 'S3 upload failed');
      throw internal('Could not save the uploaded file. Please try again.', err);
    }
  }

  async get(key: string): Promise<Buffer> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!result.Body) throw internal('Storage returned an empty file.');
      // `Body` is a Node.js `Readable` wrapped in the SDK's stream mixin, which
      // adds this helper for exactly this case — no manual chunk-collection loop.
      const bytes = await result.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (err) {
      if (isNotFound(err)) throw internal('That file could not be found in storage.');
      logger.error({ err, key }, 'S3 download failed');
      throw internal('Could not read the requested file. Please try again.', err);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      // S3 treats deleting a key that doesn't exist as a success (204), matching
      // the local driver's `{ force: true }` behaviour — no existence check needed.
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      // A failed delete must never surface as a failed attachment-delete to the
      // user — attachment.service.ts already treats storage delete failures as
      // non-fatal and logs them; this just gives it something useful to log.
      logger.warn({ err, key }, 'S3 delete failed');
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      logger.error({ err, key }, 'S3 existence check failed');
      throw internal('Could not check storage. Please try again.', err);
    }
  }

  async presignedGetUrl(key: string, expiresInSeconds: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { name?: string }).name;
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}

let driver: StorageDriver | null = null;

export function getStorageDriver(): StorageDriver {
  if (driver) return driver;

  if (env.STORAGE_DRIVER === 's3') {
    const { S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT } = env;
    const missing = [
      !S3_BUCKET && 'S3_BUCKET',
      !S3_REGION && 'S3_REGION',
      !S3_ACCESS_KEY_ID && 'S3_ACCESS_KEY_ID',
      !S3_SECRET_ACCESS_KEY && 'S3_SECRET_ACCESS_KEY',
    ].filter(Boolean);

    if (missing.length > 0) {
      // Fail loudly at first use, exactly like the previous "not implemented"
      // guard did — a half-configured storage driver must never silently fall
      // back to something else.
      throw internal(
        `STORAGE_DRIVER=s3 is set but missing required configuration: ${missing.join(', ')}. See docs/DEPLOYMENT.md.`,
      );
    }

    driver = new S3StorageDriver({
      bucket: S3_BUCKET!,
      region: S3_REGION!,
      endpoint: S3_ENDPOINT,
      accessKeyId: S3_ACCESS_KEY_ID!,
      secretAccessKey: S3_SECRET_ACCESS_KEY!,
    });
    return driver;
  }

  driver = new LocalStorageDriver(env.STORAGE_DIR);
  return driver;
}

/** Test-only: force a fresh driver to be constructed on the next call. */
export function __resetStorageDriverForTests(): void {
  driver = null;
}
