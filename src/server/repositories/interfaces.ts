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
