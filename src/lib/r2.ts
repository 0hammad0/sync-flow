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
  if (!prefix || prefix === '/') throw new Error('deletePrefix: refusing empty prefix');
  let deleted = 0;
  let continuationToken: string | undefined;
  do {
    const page = await r2().send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    const keys = (page.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => !!k);
    if (keys.length > 0) {
      await r2().send(
        new DeleteObjectsCommand({
          Bucket: R2_BUCKET,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        })
      );
      deleted += keys.length;
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return deleted;
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await r2().send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch (err: unknown) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    const name = (err as { name?: string })?.name;
    if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') return false;
    throw err;
  }
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
      ? `attachment; filename="${options.downloadFilename}"`
      : undefined,
  });
  return getSignedUrl(r2(), cmd, { expiresIn });
}
