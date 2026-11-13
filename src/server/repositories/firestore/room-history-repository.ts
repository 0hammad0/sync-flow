import 'server-only';

import { FieldPath, Timestamp, type Firestore, type Query } from 'firebase-admin/firestore';
import { z } from 'zod';

import { COLLECTIONS } from '@/server/firestore/collections';
import type { QuotaMeter } from '@/server/quota/quota-guard';
import type {
  RoomHistoryClose,
  RoomHistoryEntry,
  RoomHistoryOpen,
  RoomHistoryPage,
  RoomHistoryRepository,
} from '@/server/repositories/interfaces';
import { decodeJsonCursor, encodeJsonCursor, guarded } from './quota-call';

const MAX_LIMIT = 100;
/** Firestore's cap on operations in one batch. */
const RETENTION_BATCH_MAX = 500;

const peakOf = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const nullableString = z.string().nullish().catch(null).transform((v) => v ?? null);
const nullableCount = z.number().nonnegative().nullish().catch(null).transform((v) => v ?? null);

const historyDoc = z.object({
  name: nullableString,
  created_at: z.instanceof(Timestamp),
  expires_at: z.instanceof(Timestamp),
  ttl_hours: z.number().catch(0),
  created_by: nullableString,
  closed_at: z.instanceof(Timestamp),
  closed_by: z.string().catch('unknown'),
  message_count: nullableCount,
  attachment_count: nullableCount,
  attachment_bytes: nullableCount,
  voice_count: nullableCount,
  peak_online: nullableCount,
});

const cursorSchema = z.object({ s: z.number(), n: z.number(), id: z.string() });

function openFields(room: RoomHistoryOpen) {
  return {
    name: room.name,
    created_at: Timestamp.fromDate(room.createdAt),
    expires_at: Timestamp.fromDate(room.expiresAt),
    ttl_hours: room.ttlHours,
    created_by: room.createdBy,
  };
}

/**
 * `a_rooms/{code}` (phase 1 step 1.8): one doc per room that outlives the
 * room, because the cleanup cron deletes `rooms/{code}` with recursiveDelete.
 * Metadata only [D-4]: no message text, no file names, no content.
 *
 * Quota: about 2 writes per room (open + close). Each write asks QuotaGuard
 * first and is skipped (returns false) when writes are stopped for the day,
 * so chat never waits on or fails because of it. listClosed = rows (min 1).
 *
 * `peak_online` never costs a chat write: it is raised only by admin reads
 * (notePeakOnline: 1 read + at most 1 write, in a transaction) and folded
 * into the close write (+1 read, only when someone was online at close).
 * Retention (deleteCreatedBefore) is the only delete: rows read + 1 delete
 * each, in one batch of at most 500.
 */
export class FirestoreRoomHistoryRepository implements RoomHistoryRepository {
  constructor(
    private readonly db: Firestore,
    private readonly quota: QuotaMeter,
  ) {}

  async recordOpened(room: RoomHistoryOpen): Promise<boolean> {
    // No closed_* fields: a late "opened" write can never undo a close.
    return this.write(room.code, openFields(room));
  }

  async recordClosed(room: RoomHistoryClose): Promise<boolean> {
    const data = {
      ...openFields(room),
      closed_at: Timestamp.fromDate(room.closedAt),
      closed_by: room.closedBy,
      message_count: room.messageCount,
      attachment_count: room.attachmentCount,
      attachment_bytes: room.attachmentBytes,
      voice_count: room.voiceCount,
    };
    const online = room.onlineAtClose ?? 0;
    if (!(online > 0)) return this.write(room.code, data);

    // Fold the online-at-close count into peak_online without lowering it:
    // the same one write, plus one read inside a transaction.
    if ((await this.quota.canWrite('writes')) === 'stop') return false;
    const ref = this.db.collection(COLLECTIONS.aRooms).doc(room.code);
    await guarded(this.quota, () =>
      this.db.runTransaction(async (tx) => {
        const prev = peakOf((await tx.get(ref)).get('peak_online'));
        tx.set(ref, { ...data, peak_online: Math.max(prev, online) }, { merge: true });
      }),
    );
    this.quota.record('reads', 1);
    this.quota.record('writes', 1);
    return true;
  }

  async notePeakOnline(code: string, online: number): Promise<boolean> {
    if (!Number.isFinite(online) || online <= 0) return false;
    if ((await this.quota.canWrite('writes')) === 'stop') return false;
    const ref = this.db.collection(COLLECTIONS.aRooms).doc(code);
    const wrote = await guarded(this.quota, () =>
      this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        // No history doc (write 1 was skipped): do not create a partial one.
        if (!snap.exists || peakOf(snap.get('peak_online')) >= online) return false;
        tx.update(ref, { peak_online: online });
        return true;
      }),
    );
    this.quota.record('reads', 1);
    if (wrote) this.quota.record('writes', 1);
    return wrote;
  }

  async deleteCreatedBefore(cutoff: Date, limit: number): Promise<number> {
    await this.quota.assertCan('deletes');
    const max = Math.min(Math.max(Math.floor(limit), 1), RETENTION_BATCH_MAX);
    const snap = await guarded(this.quota, () =>
      this.db
        .collection(COLLECTIONS.aRooms)
        .where('created_at', '<', Timestamp.fromDate(cutoff))
        .orderBy('created_at')
        .select()
        .limit(max)
        .get(),
    );
    this.quota.record('reads', Math.max(1, snap.size));
    if (snap.empty) return 0;
    const batch = this.db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await guarded(this.quota, () => batch.commit());
    this.quota.record('deletes', snap.size);
    return snap.size;
  }

  async listClosed(query: { cursor?: string | null; limit: number }): Promise<RoomHistoryPage> {
    await this.quota.assertCan('reads');
    const limit = Math.min(Math.max(Math.floor(query.limit), 1), MAX_LIMIT);
    // orderBy skips docs without `closed_at`, so open rooms are left out.
    let q: Query = this.db
      .collection(COLLECTIONS.aRooms)
      .orderBy('closed_at', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');
    const at = cursorSchema.safeParse(decodeJsonCursor(query.cursor));
    if (at.success) q = q.startAfter(new Timestamp(at.data.s, at.data.n), at.data.id);

    const snap = await guarded(this.quota, () => q.limit(limit).get());
    this.quota.record('reads', Math.max(1, snap.size));
    const rooms: RoomHistoryEntry[] = [];
    let last: { s: number; n: number; id: string } | null = null;
    for (const doc of snap.docs) {
      const parsed = historyDoc.safeParse(doc.data());
      const closedAt = doc.get('closed_at') as unknown;
      if (closedAt instanceof Timestamp) last = { s: closedAt.seconds, n: closedAt.nanoseconds, id: doc.id };
      if (!parsed.success) continue;
      const d = parsed.data;
      rooms.push({
        code: doc.id,
        name: d.name,
        createdAt: d.created_at.toDate(),
        expiresAt: d.expires_at.toDate(),
        ttlHours: d.ttl_hours,
        createdBy: d.created_by,
        closedAt: d.closed_at.toDate(),
        closedBy: d.closed_by,
        messageCount: d.message_count,
        attachmentCount: d.attachment_count,
        attachmentBytes: d.attachment_bytes,
        voiceCount: d.voice_count,
        peakOnline: d.peak_online,
      });
    }
    return { rooms, nextCursor: last && snap.size === limit ? encodeJsonCursor(last) : null };
  }

  private async write(code: string, data: Record<string, unknown>): Promise<boolean> {
    if ((await this.quota.canWrite('writes')) === 'stop') return false;
    await guarded(this.quota, () => this.db.collection(COLLECTIONS.aRooms).doc(code).set(data, { merge: true }));
    this.quota.record('writes', 1);
    return true;
  }
}
