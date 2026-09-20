import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The S3 storage driver, tested against a mocked AWS SDK — there is no real AWS
 * account or bucket configured for this project (see docs/DEPLOYMENT.md), so
 * this verifies the driver's own logic (which command it sends, how it turns a
 * missing object into `exists() === false` rather than a thrown error, how a
 * misconfiguration is refused) rather than actual connectivity to S3. A real
 * bucket has not been, and cannot be, exercised by this test.
 */
const sendMock = vi.fn();
const getSignedUrlMock = vi.fn().mockResolvedValue('https://example-bucket.s3.amazonaws.com/signed-get-url');

vi.mock('@aws-sdk/client-s3', () => {
  class FakeCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class PutObjectCommand extends FakeCommand {}
  class GetObjectCommand extends FakeCommand {}
  class DeleteObjectCommand extends FakeCommand {}
  class HeadObjectCommand extends FakeCommand {}
  return {
    S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock,
}));

const ORIGINAL_ENV = { ...process.env };

function notFoundError(): Error & { name: string; $metadata: { httpStatusCode: number } } {
  const err = new Error('Not Found') as Error & { name: string; $metadata: { httpStatusCode: number } };
  err.name = 'NotFound';
  err.$metadata = { httpStatusCode: 404 };
  return err;
}

async function freshStorageModule() {
  vi.resetModules();
  return import('../src/lib/storage.js');
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
  process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
  sendMock.mockReset();
  getSignedUrlMock.mockClear();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('S3 storage driver configuration', () => {
  it('fails loudly, naming exactly what is missing, rather than silently using local storage', async () => {
    process.env.STORAGE_DRIVER = 's3';
    // Deliberately leave every S3_* variable unset.
    const { getStorageDriver } = await freshStorageModule();

    expect(() => getStorageDriver()).toThrow(/S3_BUCKET/);
    expect(() => getStorageDriver()).toThrow(/S3_REGION/);
    expect(() => getStorageDriver()).toThrow(/S3_ACCESS_KEY_ID/);
    expect(() => getStorageDriver()).toThrow(/S3_SECRET_ACCESS_KEY/);
  });

  it('constructs successfully once every required S3 variable is present', async () => {
    process.env.STORAGE_DRIVER = 's3';
    process.env.S3_BUCKET = 'test-bucket';
    process.env.S3_REGION = 'ap-south-1';
    process.env.S3_ACCESS_KEY_ID = 'AKIAEXAMPLE';
    process.env.S3_SECRET_ACCESS_KEY = 'secret-example';
    const { getStorageDriver } = await freshStorageModule();

    expect(() => getStorageDriver()).not.toThrow();
  });

  it('still returns the local driver by default, unaffected by S3 env vars being unset', async () => {
    const { getStorageDriver } = await freshStorageModule();
    const driver = getStorageDriver();
    // The local driver has no presigned-URL capability — a real behavioural
    // difference a caller could branch on, not just a label.
    expect(driver.presignedGetUrl).toBeUndefined();
  });
});

describe('S3 storage driver behaviour', () => {
  async function s3Driver() {
    process.env.STORAGE_DRIVER = 's3';
    process.env.S3_BUCKET = 'test-bucket';
    process.env.S3_REGION = 'ap-south-1';
    process.env.S3_ACCESS_KEY_ID = 'AKIAEXAMPLE';
    process.env.S3_SECRET_ACCESS_KEY = 'secret-example';
    const { getStorageDriver } = await freshStorageModule();
    return getStorageDriver();
  }

  it('put() sends a PutObjectCommand with server-side encryption and no ACL', async () => {
    sendMock.mockResolvedValueOnce({});
    const driver = await s3Driver();

    const data = Buffer.from('receipt bytes');
    const result = await driver.put('ws1/2026/09/abc123.jpg', data);

    expect(result).toEqual({ key: 'ws1/2026/09/abc123.jpg', sizeBytes: data.byteLength });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(command.input.Bucket).toBe('test-bucket');
    expect(command.input.Key).toBe('ws1/2026/09/abc123.jpg');
    expect(command.input.ServerSideEncryption).toBe('AES256');
    expect(command.input.ACL).toBeUndefined();
  });

  it('get() converts the SDK stream body into a Buffer with the original bytes', async () => {
    const original = Buffer.from('hello receipt');
    sendMock.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => new Uint8Array(original) },
    });
    const driver = await s3Driver();

    const result = await driver.get('ws1/2026/09/abc123.jpg');
    expect(Buffer.compare(result, original)).toBe(0);
  });

  it('get() on a missing object throws a clean, user-safe error rather than the raw SDK error', async () => {
    sendMock.mockRejectedValueOnce(notFoundError());
    const driver = await s3Driver();

    await expect(driver.get('ws1/missing.jpg')).rejects.toThrow(/could not be found/i);
  });

  it('exists() returns true when HeadObject succeeds', async () => {
    sendMock.mockResolvedValueOnce({});
    const driver = await s3Driver();
    await expect(driver.exists('ws1/2026/09/abc123.jpg')).resolves.toBe(true);
  });

  it('exists() returns false (not a thrown error) when the object is missing', async () => {
    sendMock.mockRejectedValueOnce(notFoundError());
    const driver = await s3Driver();
    await expect(driver.exists('ws1/missing.jpg')).resolves.toBe(false);
  });

  it('delete() does not throw even when the underlying call fails, matching local-driver semantics', async () => {
    sendMock.mockRejectedValueOnce(new Error('network blip'));
    const driver = await s3Driver();
    await expect(driver.delete('ws1/2026/09/abc123.jpg')).resolves.toBeUndefined();
  });

  it('presignedGetUrl() delegates to the AWS presigner with the requested expiry', async () => {
    const driver = await s3Driver();
    const url = await driver.presignedGetUrl!('ws1/2026/09/abc123.jpg', 120);

    expect(url).toBe('https://example-bucket.s3.amazonaws.com/signed-get-url');
    expect(getSignedUrlMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ input: expect.objectContaining({ Key: 'ws1/2026/09/abc123.jpg' }) }),
      { expiresIn: 120 },
    );
  });

  it('one workspace can never resolve to another workspace\'s object key by construction', async () => {
    // Not a driver behaviour per se, but the property the whole authorization
    // model leans on: keys are generated server-side from the workspace id and
    // a random uuid, never from anything a caller supplies — so there is no
    // input that lets one workspace's request address another's object.
    const { buildStorageKey } = await freshStorageModule();
    const keyA = buildStorageKey('workspace-a', 'receipt.jpg');
    const keyB = buildStorageKey('workspace-b', 'receipt.jpg');
    expect(keyA.startsWith('workspace-a/')).toBe(true);
    expect(keyB.startsWith('workspace-b/')).toBe(true);
    expect(keyA).not.toBe(keyB);
  });
});
