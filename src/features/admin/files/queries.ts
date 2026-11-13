import 'server-only';

import { unstable_cache } from 'next/cache';
import { getContainer } from '@/server/container';
import { FileIdKeyError } from '@/server/files/file-id';
import { QuotaExceededError } from '@/server/quota/quota-guard';
import type { AdminFile } from '@/server/repositories/interfaces';
import { fileTypeOf } from './format';
import { FILE_ID_RE, type FilesParams } from './schemas';
import type { BucketDto, FileRowDto, FileUploaderDto, StorageSummaryDto } from './types';

// Files & storage queries (09-files-and-storage.md "Data"). The caller has
// already passed requireAdmin('files:read').
//
// Firestore cost (all counted by QuotaGuard, cached under the `files` tag):
// - listFiles: ≤ 25 docs per source × 3 sources (share, chat album, chat
//   single) + 1 cursor read per chat source on later pages. Typical first
//   page ≈ 25–75 reads, cached 5 min.
// - getFile: 1 read, cached 5 min.
// - getStorageSummary: 2 aggregations (≈ 1 read per 1,000 share files each),
//   cached 10 min. R2: GraphQL 1 call + `chat/` listing (1 call per 1,000
//   objects), cached 10 min. No Firestore read at all for the R2 parts.
// Uploader emails come from Firebase Auth (not Firestore), one lookup per
// distinct signed-in uploader on the page.

export const FILES_TAG = 'files';
export const R2_USAGE_TAG = 'r2-usage';
export const FILES_PAGE_SIZE = 25;
const LIST_TTL_S = 300;
const SUMMARY_TTL_S = 600;
/** Free tier: 10 GB-month of R2 storage. */
export const R2_FREE_BYTES = 10e9;

export type QueryFailure =
  /** Admin read budget used up for today (QuotaGuard). */
  | { state: 'budget' }
  /** ADMIN_FILE_ID_KEY is not set. */
  | { state: 'setup' }
  /** A chat query needs a Firestore index that is not deployed. */
  | { state: 'index' }
  | { state: 'error'; errorId: string };

function isMissingIndex(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 9 || code === 'failed-precondition' || code === 'FAILED_PRECONDITION';
}

/** `Error 5` style summary with no message text. */
export function errorKind(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' || typeof code === 'number' ? `${name} ${code}` : name;
}

export function toQueryFailure(error: unknown, what: string): QueryFailure {
  if (error instanceof QuotaExceededError) return { state: 'budget' };
  if (error instanceof FileIdKeyError) return { state: 'setup' };
  if (isMissingIndex(error)) return { state: 'index' };
  const errorId = crypto.randomUUID();
  // Name and code only: a Firestore message can hold a doc path, and a share
  // doc's id is its token. Never log a file id, key, path or token.
  console.error(`[admin] files: ${what} failed ${errorId}`, errorKind(error));
  return { state: 'error', errorId };
}

async function uploaderLabels(files: AdminFile[], withEmails: boolean): Promise<Map<string, string | null>> {
  const uids = [...new Set(files.map((f) => f.uploaderUid).filter((u): u is string => Boolean(u)))];
  const labels = new Map<string, string | null>();
  if (!withEmails) return labels;
  const users = getContainer().users;
  await Promise.all(
    uids.map(async (uid) => {
      const user = await users.get(uid).catch(() => undefined);
      // undefined: lookup failed (show the generic label). null: no such user.
      if (user !== undefined) labels.set(uid, user ? (user.email ?? 'Signed-in user') : null);
    }),
  );
  return labels;
}

function uploaderOf(file: AdminFile, labels: Map<string, string | null>): FileUploaderDto {
  if (file.uploaderUid) {
    const label = labels.get(file.uploaderUid);
    return { uid: file.uploaderUid, label: label === null ? 'Deleted user' : (label ?? 'Signed-in user') };
  }
  const sender = file.senderName?.trim();
  return { uid: null, label: sender ? `${sender} (guest)` : 'Guest' };
}

/** The only mapping from a stored file to what the client sees. No name, key or token [D-4, D-6]. */
export function toFileRowDto(file: AdminFile, uploader: FileUploaderDto): FileRowDto {
  return {
    id: file.id,
    kind: file.kind,
    type: fileTypeOf(file.mimeType, file.voiceDurationMs !== null),
    mimeType: file.mimeType,
    size: file.size,
    createdAt: file.createdAt.toISOString(),
    uploader,
    roomCode: file.roomCode,
    expiresAt: file.expiresAt?.toISOString() ?? null,
    downloads: file.downloadCount,
    maxDownloads: file.maxDownloads,
    isEncrypted: file.isEncrypted,
    voiceDurationMs: file.voiceDurationMs,
  };
}

export async function toFileRowDtos(files: AdminFile[], withEmails: boolean): Promise<FileRowDto[]> {
  const labels = await uploaderLabels(files, withEmails);
  return files.map((f) => toFileRowDto(f, uploaderOf(f, labels)));
}

// Errors throw out of the cache, so a failure is never cached; only rows are.
const cachedPage = unstable_cache(
  async (kind: FilesParams['kind'], expired: boolean, cursor: string | null, withEmails: boolean) => {
    const page = await getContainer().files.list({
      kind,
      expired: expired || undefined,
      cursor,
      limit: FILES_PAGE_SIZE,
    });
    return { rows: await toFileRowDtos(page.files, withEmails), nextCursor: page.nextCursor };
  },
  ['admin-files-list'],
  { tags: [FILES_TAG], revalidate: LIST_TTL_S },
);

/** `checkedAt`: epoch ms of this request, for relative times (render must stay pure). */
export type FilesPageResult = { state: 'ok'; rows: FileRowDto[]; nextCursor: string | null; checkedAt: number } | QueryFailure;

/** One page of files, newest first (expired filter: oldest expiry first). */
export async function listFiles(params: FilesParams, withEmails: boolean): Promise<FilesPageResult> {
  try {
    const page = await cachedPage(params.kind, params.expired, params.cursor ?? null, withEmails);
    return { state: 'ok', ...page, checkedAt: Date.now() };
  } catch (error) {
    return toQueryFailure(error, 'list');
  }
}

const cachedFile = unstable_cache(
  async (id: string, withEmails: boolean): Promise<FileRowDto | null> => {
    const file = await getContainer().files.get(id);
    return file ? (await toFileRowDtos([file], withEmails))[0] : null;
  },
  ['admin-files-get'],
  { tags: [FILES_TAG], revalidate: LIST_TTL_S },
);

export type FileResult = { state: 'ok'; file: FileRowDto; checkedAt: number } | { state: 'not_found' } | QueryFailure;

/** One file for the drawer / detail page. A malformed or foreign id is "not found" with no read. */
export async function getFile(id: string, withEmails: boolean): Promise<FileResult> {
  if (!FILE_ID_RE.test(id)) return { state: 'not_found' };
  try {
    const file = await cachedFile(id, withEmails);
    return file ? { state: 'ok', file, checkedAt: Date.now() } : { state: 'not_found' };
  } catch (error) {
    return toQueryFailure(error, 'get');
  }
}

const cachedBucket = unstable_cache(
  async (): Promise<Exclude<BucketDto, { state: 'error' }>> => {
    const totals = await getContainer().files.bucketTotals();
    if (!totals) return { state: 'not_configured' };
    return {
      state: 'ok',
      objectCount: totals.objectCount,
      payloadBytes: totals.payloadBytes,
      limitBytes: R2_FREE_BYTES,
      measuredAt: totals.measuredAt.toISOString(),
    };
  },
  ['admin-files-bucket'],
  { tags: [R2_USAGE_TAG], revalidate: SUMMARY_TTL_S },
);

const cachedChatUsage = unstable_cache(
  async () => getContainer().files.prefixUsage('chat/'),
  ['admin-files-chat-usage'],
  { tags: [R2_USAGE_TAG], revalidate: SUMMARY_TTL_S },
);

const cachedShareTotals = unstable_cache(async () => getContainer().files.shareTotals(), ['admin-files-share-totals'], {
  tags: [FILES_TAG],
  revalidate: SUMMARY_TTL_S,
});

const cachedNotSwept = unstable_cache(async () => getContainer().files.expiredOwnedTotals(), ['admin-files-not-swept'], {
  tags: [FILES_TAG],
  revalidate: SUMMARY_TTL_S,
});

/** Settles one panel part: a failure shows as "unknown" for that part, not a broken page. */
async function settle<T>(what: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    toQueryFailure(error, what);
    return null;
  }
}

/** R2 usage vs the free tier, plus the share / chat breakdown and the not-swept count. */
export async function getStorageSummary(): Promise<StorageSummaryDto> {
  const [bucket, share, chat, notSwept] = await Promise.all([
    cachedBucket().catch((error: unknown): BucketDto => {
      const failure = toQueryFailure(error, 'r2 totals');
      return { state: 'error', errorId: failure.state === 'error' ? failure.errorId : 'n/a' };
    }),
    settle('share totals', cachedShareTotals),
    settle('chat usage', cachedChatUsage),
    settle('not swept', cachedNotSwept),
  ]);
  return { bucket, share, chat, notSwept };
}
