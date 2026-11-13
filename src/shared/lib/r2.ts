import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const endpoint = process.env.R2_ENDPOINT;

export const R2_BUCKET = process.env.R2_BUCKET || 'syncflow-files';

let client: S3Client | null = null;

export function r2(): S3Client {
  if (!accountId || !accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error(
      'Missing Cloudflare R2 credentials. Check R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT in .env.local'
    );
  }
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return client;
}

// Separate client for presigned browser uploads. Newer SDKs add flexible
// checksum params (x-amz-checksum-crc32 of an EMPTY body) to presigned PUTs,
// which a browser upload of the real file can never satisfy — so only
// compute checksums when an operation strictly requires one.
let presignClient: S3Client | null = null;

function r2Presign(): S3Client {
  r2(); // reuse the credential check + error message
  if (!presignClient) {
    presignClient = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }
  return presignClient;
}

/**
 * Presigned PUT URL so the browser uploads straight to R2. This bypasses the
 * hosting platform's request-body cap (Vercel functions reject bodies over
 * ~4.5 MB with 413 FUNCTION_PAYLOAD_TOO_LARGE before our code runs).
 * Content-Type and Content-Length are signed, so R2 rejects a PUT whose type
 * or size differs from what the server approved.
 */
export async function signedUploadUrl(
  key: string,
  contentType: string,
  contentLength: number,
  expiresIn: number = 900
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(r2Presign(), cmd, {
    expiresIn,
    signableHeaders: new Set(['content-type', 'content-length']),
  });
}

/** Size in bytes of a stored object, or null when it does not exist. */
export async function objectSize(key: string): Promise<number | null> {
  try {
    const res = await r2().send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return res.ContentLength ?? null;
  } catch (err: unknown) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    const name = (err as { name?: string })?.name;
    if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') return null;
    throw err;
  }
}

export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
  await r2().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function deleteObject(key: string): Promise<void> {
  await r2().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

/**
 * Delete every object under a prefix (e.g. `chat/{roomCode}/`). Pages through
 * ListObjectsV2 and batch-deletes 1000 at a time. Returns objects deleted.
 */
export async function deletePrefix(prefix: string): Promise<number> {
  return (await deletePrefixCounted(prefix)).objects;
}

/** Like deletePrefix, and also sums the deleted objects' sizes (from the same listing, no extra call). */
export async function deletePrefixCounted(prefix: string): Promise<{ objects: number; bytes: number }> {
  if (!prefix || prefix === '/') throw new Error('deletePrefix: refusing empty prefix');
  let deleted = 0;
  let bytes = 0;
  let continuationToken: string | undefined;
  do {
    const page = await r2().send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    const objects = (page.Contents ?? []).filter((o): o is typeof o & { Key: string } => !!o.Key);
    if (objects.length > 0) {
      await r2().send(
        new DeleteObjectsCommand({
          Bucket: R2_BUCKET,
          Delete: { Objects: objects.map(({ Key }) => ({ Key })), Quiet: true },
        })
      );
      deleted += objects.length;
      for (const o of objects) bytes += o.Size ?? 0;
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return { objects: deleted, bytes };
}

/** Object count and summed size under a prefix. Read only (ListObjectsV2 pages). */
export async function prefixUsage(prefix: string): Promise<{ objects: number; bytes: number }> {
  if (!prefix || prefix === '/') throw new Error('prefixUsage: refusing empty prefix');
  let objects = 0;
  let bytes = 0;
  let continuationToken: string | undefined;
  do {
    const page = await r2().send(
      new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: continuationToken })
    );
    for (const o of page.Contents ?? []) {
      if (!o.Key) continue;
      objects++;
      bytes += o.Size ?? 0;
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return { objects, bytes };
}

export async function objectExists(key: string): Promise<boolean> {
  return (await objectSize(key)) !== null;
}

/**
 * `Content-Disposition: attachment` that survives any filename: a plain-ASCII
 * `filename=` fallback for old clients plus the RFC 5987 `filename*` with the
 * exact UTF-8 name (spaces, accents, emoji, quotes) for every current browser.
 */
export function attachmentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_') || 'file';
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function signedDownloadUrl(
  key: string,
  expiresIn: number = 3600,
  options?: { downloadFilename?: string }
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ResponseContentDisposition: options?.downloadFilename
      ? attachmentDisposition(options.downloadFilename)
      : undefined,
  });
  return getSignedUrl(r2(), cmd, { expiresIn });
}
