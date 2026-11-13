import 'server-only';

import { unstable_cache } from 'next/cache';
import type { AdminContext } from '@/server/auth/types';
import { getContainer } from '@/server/container';
import { QuotaExceededError } from '@/server/quota/quota-guard';
import type { AuditAction, AuditEntry, AuditListQuery } from '@/server/repositories/interfaces';
import type { AuditData } from './diff';
import { AUDIT_RANGE_MS, type AuditParams, type AuditRange } from './schemas';
import type { AuditRowDto } from './types';

// Audit log queries (11-audit-log.md "Data"). The caller has already passed
// requireAdmin('audit:read'). Read only: nothing here (or anywhere in the
// admin) can change or remove an audit row.
//
// Firestore cost: one query, ≤ 25 reads (min 1) per page, cached 60 s per
// filter set under the `audit` tag. No count() (the AuditRepository is kept
// to append / appendOnce / list, T-23), so no total is shown.

export const AUDIT_TAG = 'audit';
export const AUDIT_PAGE_SIZE = 25;
const LIST_TTL_S = 60;

/** Which single filter the query applied (each has its own composite index). */
export type AuditScope = {
  /** Moderators: always their own uid. */
  actorUid: string | null;
  action: AuditAction | null;
  targetId: string | null;
  /** The moderator scope was forced by the server. */
  ownOnly: boolean;
  /** Filters from the URL that were dropped (no index for that combination). */
  ignored: ('actor' | 'action' | 'q')[];
};

/**
 * The filter set the query may use. Enforced here, not in the UI:
 * - Moderator (anything but owner): `actor_uid = ctx.uid`, always. `?actor=`
 *   is ignored, `?action=` stacks on top (`(actor_uid, action, at)` index),
 *   `?q=` is ignored (no `(actor_uid, target_id, at)` index).
 * - Owner: one of q (exact target id) > action > actor.
 */
export function auditScope(ctx: Pick<AdminContext, 'uid' | 'role'>, params: Pick<AuditParams, 'actor' | 'action' | 'q'>): AuditScope {
  if (ctx.role !== 'owner') {
    const ignored: AuditScope['ignored'] = [];
    if (params.actor && params.actor !== ctx.uid) ignored.push('actor');
    if (params.q) ignored.push('q');
    return { actorUid: ctx.uid, action: params.action ?? null, targetId: null, ownOnly: true, ignored };
  }
  if (params.q) {
    return {
      actorUid: null,
      action: null,
      targetId: params.q,
      ownOnly: false,
      ignored: [...(params.actor ? (['actor'] as const) : []), ...(params.action ? (['action'] as const) : [])],
    };
  }
  if (params.action) {
    return { actorUid: null, action: params.action, targetId: null, ownOnly: false, ignored: params.actor ? ['actor'] : [] };
  }
  return { actorUid: params.actor ?? null, action: null, targetId: null, ownOnly: false, ignored: [] };
}

/** The repository query for a scope. `from` = now − range. */
export function auditListQuery(scope: AuditScope, range: AuditRange, cursor: string | null, nowMs: number): AuditListQuery {
  return {
    ...(scope.actorUid ? { actorUid: scope.actorUid } : {}),
    ...(scope.action ? { action: scope.action } : {}),
    ...(scope.targetId ? { targetId: scope.targetId } : {}),
    from: new Date(nowMs - AUDIT_RANGE_MS[range]),
    cursor,
    limit: AUDIT_PAGE_SIZE,
  };
}

const FILE_TARGETS = new Set(['share_file', 'chat_attachment', 'r2_object']);
/** Keys that could hold a file name or key in an older row. Dropped on read [D-6, D-4]. */
const FILE_NAME_KEYS = new Set(['name', 'filename', 'fileName', 'file_name', 'original_name', 'originalName', 'key', 'r2Key', 'path', 'file_path']);

function dropFileNames(data: AuditData): AuditData {
  if (!data) return null;
  return Object.fromEntries(Object.entries(data).filter(([k]) => !FILE_NAME_KEYS.has(k)));
}

/**
 * The only mapping from a stored row to what the client sees. File rows lose
 * any name or key field (rows written before D-6 had `before.name`), and a
 * readable `s_<token>` target id from before the opaque ids is hidden.
 */
export function toAuditRowDto(entry: AuditEntry): AuditRowDto {
  const isFile = entry.action === 'file.delete' || (entry.targetType !== null && FILE_TARGETS.has(entry.targetType));
  const legacyToken = isFile && entry.targetId !== null && /^s_/.test(entry.targetId);
  return {
    id: entry.id,
    at: entry.at.toISOString(),
    actorUid: entry.actorUid,
    actorEmail: entry.actorEmail,
    actorRole: entry.actorRole,
    action: entry.action,
    targetType: entry.targetType,
    targetId: legacyToken ? 'hidden (old share id)' : entry.targetId,
    reason: entry.reason,
    ip: entry.ip,
    userAgent: entry.userAgent,
    before: isFile ? dropFileNames(entry.before) : entry.before,
    after: isFile ? dropFileNames(entry.after) : entry.after,
  };
}

// The scope (incl. a moderator's forced uid) is part of the cache key, so a
// cached page is never served across users. Errors are never cached.
const cachedPage = unstable_cache(
  async (actorUid: string | null, action: AuditAction | null, targetId: string | null, range: AuditRange, cursor: string | null) => {
    const scope: AuditScope = { actorUid, action, targetId, ownOnly: false, ignored: [] };
    const page = await getContainer().audit.list(auditListQuery(scope, range, cursor, Date.now()));
    return { rows: page.entries.map(toAuditRowDto), nextCursor: page.nextCursor };
  },
  ['admin-audit-list'],
  { tags: [AUDIT_TAG], revalidate: LIST_TTL_S },
);

export type AuditPageResult =
  | { state: 'ok'; rows: AuditRowDto[]; nextCursor: string | null; scope: AuditScope }
  | { state: 'budget'; scope: AuditScope }
  | { state: 'error'; errorId: string; scope: AuditScope };

/** One page of the audit log, newest first, scoped for the caller's role. */
export async function listAuditEntries(ctx: AdminContext, params: AuditParams): Promise<AuditPageResult> {
  const scope = auditScope(ctx, params);
  try {
    const page = await cachedPage(scope.actorUid, scope.action, scope.targetId, params.range, params.cursor ?? null);
    return { state: 'ok', ...page, scope };
  } catch (error) {
    if (error instanceof QuotaExceededError) return { state: 'budget', scope };
    const errorId = crypto.randomUUID();
    console.error(`[admin] audit list failed ${errorId}`, error instanceof Error ? error.name : 'unknown');
    return { state: 'error', errorId, scope };
  }
}
