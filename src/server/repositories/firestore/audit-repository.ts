import 'server-only';

import { FieldPath, FieldValue, Timestamp, type Firestore, type Query } from 'firebase-admin/firestore';
import { z } from 'zod';

import { COLLECTIONS } from '@/server/firestore/collections';
import type { QuotaMeter } from '@/server/quota/quota-guard';
import {
  AUDIT_ACTIONS,
  type AuditEntry,
  type AuditListQuery,
  type AuditPage,
  type AuditRepository,
  type NewAuditEntry,
} from '@/server/repositories/interfaces';

const MAX_LIMIT = 100;

/** Lenient on optional fields so an older or script-written row never breaks the list. */
const nullableString = z.string().nullish().catch(null).transform((v) => v ?? null);
const auditData = z
  .record(z.string(), z.unknown())
  .nullish()
  .catch(null)
  .transform((v) => v ?? null);

const auditDoc = z.object({
  at: z.instanceof(Timestamp),
  actor_uid: nullableString,
  actor_email: nullableString,
  actor_role: z
    .enum(['owner', 'moderator', 'viewer'])
    .nullish()
    .catch(null)
    .transform((v) => v ?? null),
  action: z.enum(AUDIT_ACTIONS),
  target_type: nullableString,
  target_id: nullableString,
  before: auditData,
  after: auditData,
  reason: nullableString,
  ip: nullableString,
  user_agent: nullableString,
});

type Cursor = { at: Timestamp; id: string };

/** Cursor = base64url("seconds.nanoseconds.id"). Full precision, so no row is skipped. */
function encodeCursor(at: Timestamp, id: string): string {
  return Buffer.from(`${at.seconds}.${at.nanoseconds}.${id}`).toString('base64url');
}

function decodeCursor(cursor: string | null | undefined): Cursor | null {
  if (!cursor) return null;
  const match = /^(\d+)\.(\d+)\.(.+)$/.exec(Buffer.from(cursor, 'base64url').toString());
  if (!match) return null;
  const nanos = Number(match[2]);
  if (nanos > 999_999_999) return null;
  return { at: new Timestamp(Number(match[1]), nanos), id: match[3] };
}

/**
 * `admin_audit` on Firestore. Append-only: `append` and `list` are the only
 * methods (T-23); keep helpers as module functions so the type test and the
 * prototype check in tests/integration/firestore/admin-rules.test.ts hold.
 *
 * Quota: append = 1 write (always allowed, still counted). list = 1 read per
 * row returned, minimum 1, and refuses with QuotaExceededError at the read cap.
 */
export class FirestoreAuditRepository implements AuditRepository {
  constructor(
    private readonly db: Firestore,
    private readonly quota: QuotaMeter,
  ) {}

  async append(entry: NewAuditEntry): Promise<string> {
    const ref = this.db.collection(COLLECTIONS.adminAudit).doc();
    try {
      await ref.set({
        at: FieldValue.serverTimestamp(),
        actor_uid: entry.actorUid,
        actor_email: entry.actorEmail,
        actor_role: entry.actorRole,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId,
        before: entry.before,
        after: entry.after,
        reason: entry.reason,
        ip: entry.ip,
        user_agent: entry.userAgent,
      });
    } catch (error) {
      this.quota.noteError(error);
      throw error;
    }
    this.quota.record('writes', 1);
    return ref.id;
  }

  async list(query: AuditListQuery): Promise<AuditPage> {
    await this.quota.assertCan('reads');
    const limit = Math.min(Math.max(Math.floor(query.limit), 1), MAX_LIMIT);

    let q: Query = this.db.collection(COLLECTIONS.adminAudit);
    if (query.actorUid) q = q.where('actor_uid', '==', query.actorUid);
    if (query.action) q = q.where('action', '==', query.action);
    if (query.targetId) q = q.where('target_id', '==', query.targetId);
    if (query.from) q = q.where('at', '>=', Timestamp.fromDate(query.from));
    if (query.to) q = q.where('at', '<', Timestamp.fromDate(query.to));
    q = q.orderBy('at', 'desc').orderBy(FieldPath.documentId(), 'desc');
    const cursor = decodeCursor(query.cursor);
    if (cursor) q = q.startAfter(cursor.at, cursor.id);

    let snap;
    try {
      snap = await q.limit(limit).get();
    } catch (error) {
      this.quota.noteError(error);
      throw error;
    }
    // An empty result still bills one read.
    this.quota.record('reads', Math.max(1, snap.size));

    const entries: AuditEntry[] = [];
    let last: Cursor | null = null;
    for (const doc of snap.docs) {
      const d = auditDoc.parse(doc.data());
      entries.push({
        id: doc.id,
        at: d.at.toDate(),
        actorUid: d.actor_uid,
        actorEmail: d.actor_email,
        actorRole: d.actor_role,
        action: d.action,
        targetType: d.target_type,
        targetId: d.target_id,
        before: d.before,
        after: d.after,
        reason: d.reason,
        ip: d.ip,
        userAgent: d.user_agent,
      });
      last = { at: d.at, id: doc.id };
    }
    // A full page may have more; the next call returns an empty page if not.
    // Cheaper than fetching limit + 1 on every page.
    const nextCursor = last && entries.length === limit ? encodeCursor(last.at, last.id) : null;
    return { entries, nextCursor };
  }
}
