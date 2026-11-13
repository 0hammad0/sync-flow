import 'server-only';

import type { AdminRole } from '@/server/auth/types';

/** Every action the audit log knows. Catalogue: docs 03-features/11-audit-log.md. */
export const AUDIT_ACTIONS = [
  'auth.sign_in',
  'auth.sign_out',
  'auth.denied',
  'auth.step_up',
  'block.create',
  'block.update',
  'block.remove',
  'block.restore',
  'file.delete',
  'storage.orphan_scan',
  'room.close',
  'user.disable',
  'user.enable',
  'user.revoke_sessions',
  'role.set',
  'settings.update',
  'analytics.delete',
  'export.csv',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** JSON-safe map stored in `before` / `after`. */
export type AuditData = Record<string, unknown>;

/** One row as the caller hands it to the repository (`at` and `id` are set by the store). */
export type NewAuditEntry = {
  actorUid: string | null;
  actorEmail: string | null;
  /** `null` for denied users who hold no role. */
  actorRole: AdminRole | null;
  action: AuditAction;
  targetType: string | null;
  targetId: string | null;
  before: AuditData | null;
  after: AuditData | null;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
};

export type AuditEntry = NewAuditEntry & { id: string; at: Date };

/**
 * Filters map one-to-one to the composite indexes on `admin_audit`:
 * none, actorUid, action, targetId, or actorUid + action. Other combinations
 * have no index and fail on real Firestore.
 */
export type AuditListQuery = {
  actorUid?: string;
  action?: AuditAction;
  targetId?: string;
  /** Inclusive lower bound on `at`. */
  from?: Date;
  /** Exclusive upper bound on `at`. */
  to?: Date;
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor?: string | null;
  limit: number;
};

export type AuditPage = { entries: AuditEntry[]; nextCursor: string | null };

/**
 * Append-only by design (T-23): there is no update or delete method, and a
 * type test fails if one is added. Only the retention cron may delete rows,
 * through its own class.
 */
export interface AuditRepository {
  /** Writes one row and returns its id. Throws if the write fails. */
  append(entry: NewAuditEntry): Promise<string>;
  /**
   * Writes one row under a caller-chosen id, only if no row has that id yet.
   * Never overwrites: returns `true` when written, `false` when the id was
   * already taken (the stored row is left as it was). Throws on any other
   * failure. Used for "once per X" rows such as `auth.sign_in` per session.
   */
  appendOnce(id: string, entry: NewAuditEntry): Promise<boolean>;
  /** Newest first (`at` desc, then id desc), cursor paged. */
  list(query: AuditListQuery): Promise<AuditPage>;
}

// ---------------------------------------------------------------------------
// Blocks (phase 1.5, access control). Spec: docs/admin/03-features/10-access-control.md
// Kept as one block (inline type imports) so parallel phase-1 work merges cleanly.

export type BlockType = import('@/shared/lib/block-values').BlockType;
export type BlockStatus = 'active' | 'expired' | 'removed';

/** `blocks/{id}`: history, reason, expiry, hit counter. */
export type BlockRecord = {
  id: string;
  type: BlockType;
  value: string;
  reason: string;
  createdBy: string;
  createdByEmail: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  removedAt: Date | null;
  removedBy: string | null;
  /** Approximate: counted per instance, flushed on each cache refresh. */
  hits: number;
};

export type NewBlock = Pick<BlockRecord, 'type' | 'value' | 'reason' | 'createdBy' | 'createdByEmail' | 'expiresAt'>;

export type BlockListQuery = {
  status: BlockStatus;
  type?: BlockType;
  /** A normalised value (exact) or a support ref / its 6-char id prefix. No paging with `q`. */
  q?: string;
  cursor?: string | null;
  limit: number;
  now: Date;
};

export type BlockPage = { blocks: BlockRecord[]; nextCursor: string | null };

export type BlockCreateResult =
  | { ok: true; block: BlockRecord }
  | { ok: false; reason: 'duplicate'; existing: { id: string; expiresAt: Date | null } };

export type BlockRemoveResult =
  | { ok: true; block: BlockRecord }
  | { ok: false; reason: 'not_found' | 'already_removed' };

/**
 * Every write is one transaction: `blocks/{id}` + `admin_config/blocklist`
 * (`version + 1`) + the `admin_audit` row, all or nothing. The caller builds
 * the audit row from the stored block, so before/after are exact.
 * Also the blocklist cache's source (lazy read + hit flush).
 */
type BlocklistSource = import('@/server/blocklist/cache').BlocklistSource;
export interface BlockRepository extends BlocklistSource {
  create(block: NewBlock, audit: (stored: BlockRecord) => NewAuditEntry, now: Date): Promise<BlockCreateResult>;
  remove(
    id: string,
    removedBy: string,
    audit: (before: BlockRecord, after: BlockRecord) => NewAuditEntry,
    now: Date,
  ): Promise<BlockRemoveResult>;
  get(id: string): Promise<BlockRecord | null>;
  list(query: BlockListQuery): Promise<BlockPage>;
  count(status: BlockStatus, now: Date, type?: BlockType): Promise<number>;
  /** Drops expired entries from `admin_config/blocklist` (cron). Returns how many. No audit row. */
  sweepExpired(now: Date): Promise<number>;
}
// ===========================================================================
// Phase 1 core: files, rooms, users, storage, cron runs, room history.
// Keep these additions in this one block (other phase 1 work adds its own).
//
// D-4: the admin never reads message text, images, voice or file contents.
// No type below carries message text, a signed URL or file bytes. The only
// R2 key is returned by FileRemover.storageKeyOf, for deletion on the server.

/**
 * Opaque `f_…` id from FileIdCodec (src/server/files/file-id.ts). It never
 * contains a share token, room code or message id in readable form.
 */
export type AdminFileId = string;
export type AdminFileKind = 'share' | 'chat';

/** One stored file as metadata only. No name [D-6], no storage key, no URL, no content [D-4]. */
export type AdminFile = {
  id: AdminFileId;
  kind: AdminFileKind;
  mimeType: string;
  size: number;
  createdAt: Date;
  /** Share: `owner_id`. Chat: `sender_id`. null = guest. */
  uploaderUid: string | null;
  /** Chat only: the sender's display name. */
  senderName: string | null;
  /** Chat only. */
  roomCode: string | null;
  /** Share only. */
  expiresAt: Date | null;
  downloadCount: number | null;
  maxDownloads: number | null;
  isEncrypted: boolean;
  /** Chat voice notes only. */
  voiceDurationMs: number | null;
};

/**
 * `kind: 'all'` merges share files and chat attachments, newest first.
 * `ownerUid` and `expired` apply to share files only (so they imply `share`);
 * `expired` lists share files past `expires_at`, oldest expiry first.
 * `roomCode` applies to chat attachments only (so it implies `chat`).
 */
export type FileListQuery = {
  kind?: AdminFileKind | 'all';
  ownerUid?: string;
  roomCode?: string;
  expired?: boolean;
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor?: string | null;
  limit: number;
};

/** A page can hold a few more rows than `limit`: an album message is never split across pages. */
export type FilePage = { files: AdminFile[]; nextCursor: string | null };

export type StoredBytes = { count: number; bytes: number };

export interface FileReader {
  list(query: FileListQuery, now: Date): Promise<FilePage>;
  get(id: AdminFileId): Promise<AdminFile | null>;
  /** Every share file: count and summed size (aggregate). */
  shareTotals(): Promise<StoredBytes>;
  /** Share files of one owner (aggregate). */
  ownerTotals(uid: string): Promise<StoredBytes>;
  /** Signed-in users' share files past `expires_at` (the cron skips them; phase 1 step 1.0). */
  expiredOwnedTotals(now: Date): Promise<StoredBytes>;
}

export interface FileRemover {
  /** R2 key of the file, so the object can be deleted first. null when the record is gone. Server use only. */
  storageKeyOf(id: AdminFileId): Promise<string | null>;
  /** Share: deletes the `files` doc. Chat: marks the attachment `removed_at`; message text is untouched. false when already gone. */
  removeRecord(id: AdminFileId, removedAt: Date): Promise<boolean>;
}

/** A live (or expired, not yet swept) room. Metadata only. */
export type AdminRoom = {
  code: string;
  name: string | null;
  createdAt: Date;
  expiresAt: Date;
  ttlHours: number;
  createdBy: string | null;
  creatorTz: string | null;
};

export type RoomListQuery = {
  /** `live`: not expired, soonest expiry first (default). `expiring`: expires within the hour. `all`: newest first, incl. expired. */
  status?: 'live' | 'expiring' | 'all';
  ttlHours?: 1 | 24 | 168;
  cursor?: string | null;
  limit: number;
};

export type RoomPage = { rooms: AdminRoom[]; nextCursor: string | null };

/** Counted with aggregates: no message is read. */
export type RoomCounts = { messageCount: number; voiceCount: number };

/** From projected attachment fields only (never `content`). Long-text bodies and removed files are excluded. */
export type RoomAttachmentStats = { attachmentCount: number; attachmentBytes: number; voiceCount: number; voiceBytes: number };

export interface RoomReader {
  list(query: RoomListQuery, now: Date): Promise<RoomPage>;
  get(code: string): Promise<AdminRoom | null>;
  /** Presence docs beaten since `since` (aggregate). */
  onlineCount(code: string, since: Date): Promise<number>;
  /** Non-system messages and voice notes (aggregates). */
  counts(code: string): Promise<RoomCounts>;
  attachmentStats(code: string): Promise<RoomAttachmentStats>;
}

/** What closing a room removed. `docs` is null when not counted. */
export type RoomDeleteStats = { objects: number; bytes: number; docs: number | null };

export interface RoomCloser {
  /** R2 prefix first, then the room doc and every subcollection. null when the room is already gone. */
  close(code: string): Promise<RoomDeleteStats | null>;
}

/** `a_rooms/{code}`: room history that outlives the room (step 1.8). No text, no file names. */
export type RoomHistoryOpen = Pick<AdminRoom, 'code' | 'name' | 'createdAt' | 'expiresAt' | 'ttlHours' | 'createdBy'>;

export type RoomHistoryClose = RoomHistoryOpen & {
  closedAt: Date;
  /** `cron` or the admin's uid. */
  closedBy: string;
  /** null when the counts were skipped (read budget used up, or a count failed). */
  messageCount: number | null;
  attachmentCount: number | null;
  attachmentBytes: number | null;
  voiceCount: number | null;
};

export type RoomHistoryEntry = RoomHistoryClose & { peakOnline: number | null };

export type RoomHistoryPage = { rooms: RoomHistoryEntry[]; nextCursor: string | null };

export interface RoomHistoryRepository {
  /** Write 1. false when skipped (write budget used up). */
  recordOpened(room: RoomHistoryOpen): Promise<boolean>;
  /** Write 2, with final counts. false when skipped. */
  recordClosed(room: RoomHistoryClose): Promise<boolean>;
  /** Closed rooms, newest close first. */
  listClosed(query: { cursor?: string | null; limit: number }): Promise<RoomHistoryPage>;
}

/** Firebase Auth user, as the admin sees it. */
export type AdminUser = {
  uid: string;
  email: string | null;
  role: AdminRole | null;
  disabled: boolean;
  createdAt: Date | null;
  lastSignInAt: Date | null;
  lastRefreshAt: Date | null;
};

/** Forward-only paging (Auth page tokens). */
export type UserPage = { users: AdminUser[]; nextPageToken: string | null };

export interface UserReader {
  list(query: { pageToken?: string | null; limit: number }): Promise<UserPage>;
  get(uid: string): Promise<AdminUser | null>;
  findByEmail(email: string): Promise<AdminUser | null>;
}

export type RoleGrant = { email: string | null; grantedBy: string; at: Date };

export interface UserAdmin {
  setDisabled(uid: string, disabled: boolean): Promise<void>;
  /** Ends every session at the next `verifySessionCookie(c, true)`. */
  revokeSessions(uid: string): Promise<void>;
  /** Sets the `role` claim (other claims kept) and updates the `admin_config/roles` index. null removes it. */
  setRole(uid: string, role: AdminRole | null, grant: RoleGrant): Promise<void>;
}

export type BucketTotals = { objectCount: number; payloadBytes: number; measuredAt: Date };

export interface StorageStats {
  /** Cloudflare GraphQL `r2StorageAdaptiveGroups`, latest sample. null when CF_ACCOUNT_ID / CF_API_TOKEN are not set. */
  bucketTotals(): Promise<BucketTotals | null>;
  /** Lists one prefix and sums its objects (R2 Class A calls, no Firestore). */
  prefixUsage(prefix: string): Promise<{ objects: number; bytes: number }>;
}

export interface StorageRemover {
  /** A missing object is not an error (retry is safe). */
  deleteObject(key: string): Promise<void>;
}

export const CRON_JOBS = ['cleanup', 'rollup', 'retention', 'orphan_scan'] as const;
export type CronJob = (typeof CRON_JOBS)[number];
export type CronRunStatus = 'ok' | 'partial' | 'error';
export type CronResultValue = string | number | boolean | null;

/** One `admin_cron_runs` row. `result` holds counts and flags only (never tokens or keys). */
export type NewCronRun = {
  job: CronJob;
  startedAt: Date;
  finishedAt: Date;
  status: CronRunStatus;
  result: Record<string, CronResultValue>;
  errorId: string | null;
};

export type CronRun = NewCronRun & { id: string };

export interface CronRunRepository {
  append(run: NewCronRun): Promise<string>;
  /** Newest first. */
  listRecent(job: CronJob, limit: number): Promise<CronRun[]>;
}
// ===== end phase 1 core =====
