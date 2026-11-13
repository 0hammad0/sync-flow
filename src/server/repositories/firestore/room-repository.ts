import 'server-only';

import { FieldPath, type Firestore, type Query } from 'firebase-admin/firestore';
import { z } from 'zod';

import { readsForAggregation, type QuotaMeter } from '@/server/quota/quota-guard';
import { attachmentsOf, chatMessageSchema, isListedAttachment } from '@/server/repositories/admin-files';
import type {
  AdminRoom,
  RoomAttachmentStats,
  RoomCloser,
  RoomCounts,
  RoomDeleteStats,
  RoomListQuery,
  RoomPage,
  RoomReader,
} from '@/server/repositories/interfaces';
import { MESSAGES_SUBCOLLECTION, ROOMS_COLLECTION, deleteRoom } from '@/shared/lib/firebase/chat';
import { decodeJsonCursor, encodeJsonCursor, guarded } from './quota-call';

const MAX_LIMIT = 100;
/** attachmentStats reads at most this many messages per query (rule 8). */
const STATS_MAX_DOCS = 1_000;
const EXPIRING_WINDOW_MS = 60 * 60_000;

const isoDate = z
  .string()
  .transform((v) => new Date(v))
  .refine((d) => !Number.isNaN(d.getTime()));
const nullableString = z.string().nullish().catch(null).transform((v) => v ?? null);

const roomDoc = z.object({
  name: nullableString,
  created_at: isoDate,
  expires_at: isoDate,
  ttl_hours: z.number().catch(0),
  created_by: nullableString,
  creator_tz: nullableString,
});

const cursorSchema = z.object({ v: z.string(), id: z.string() });

/** The delete step, injectable so tests do not need R2. */
export type RoomDeleter = (code: string, db: Firestore) => Promise<RoomDeleteStats>;

const defaultDeleter: RoomDeleter = (code, db) => deleteRoom(code, { db, countDocs: true });

/**
 * `rooms/{code}` as metadata only (docs/admin/03-features/12-rooms.md).
 * No query here reads `content`, `reply_to`, `reactions` or presence names:
 * only counts (aggregates) and projected attachment fields.
 *
 * Quota: list = docs returned (min 1); get = 1; each aggregate = 1 read per
 * 1,000 entries; attachmentStats = messages with files (≤ 2,000);
 * close = 1 read + every deleted doc (counted by a BulkWriter).
 */
export class FirestoreRoomRepository implements RoomReader, RoomCloser {
  constructor(
    private readonly db: Firestore,
    private readonly quota: QuotaMeter,
    private readonly deleter: RoomDeleter = defaultDeleter,
  ) {}

  async list(query: RoomListQuery, now: Date): Promise<RoomPage> {
    await this.quota.assertCan('reads');
    const limit = Math.min(Math.max(Math.floor(query.limit), 1), MAX_LIMIT);
    const status = query.status ?? 'live';
    let q: Query = this.rooms();
    if (query.ttlHours) q = q.where('ttl_hours', '==', query.ttlHours);
    let field: 'expires_at' | 'created_at' = 'expires_at';
    let dir: 'asc' | 'desc' = 'asc';
    if (status === 'all') {
      field = 'created_at';
      dir = 'desc';
    } else {
      q = q.where('expires_at', '>', now.toISOString());
      if (status === 'expiring') q = q.where('expires_at', '<', new Date(now.getTime() + EXPIRING_WINDOW_MS).toISOString());
    }
    q = q.orderBy(field, dir).orderBy(FieldPath.documentId(), dir);
    const at = cursorSchema.safeParse(decodeJsonCursor(query.cursor));
    if (at.success) q = q.startAfter(at.data.v, at.data.id);

    const snap = await guarded(this.quota, () => q.limit(limit).get());
    this.quota.record('reads', Math.max(1, snap.size));
    const rooms: AdminRoom[] = [];
    for (const doc of snap.docs) {
      const room = toRoom(doc.id, doc.data());
      if (room) rooms.push(room);
    }
    const last = snap.docs.at(-1);
    const lastValue = last?.get(field) as unknown;
    const nextCursor =
      last && snap.size === limit ? encodeJsonCursor({ v: typeof lastValue === 'string' ? lastValue : '', id: last.id }) : null;
    return { rooms, nextCursor };
  }

  async get(code: string): Promise<AdminRoom | null> {
    await this.quota.assertCan('reads');
    const snap = await guarded(this.quota, () => this.rooms().doc(code).get());
    this.quota.record('reads', 1);
    return snap.exists ? toRoom(snap.id, snap.data()) : null;
  }

  onlineCount(code: string, since: Date): Promise<number> {
    return this.count(this.rooms().doc(code).collection('presence').where('last_seen', '>', since.toISOString()));
  }

  async counts(code: string): Promise<RoomCounts> {
    const messages = this.messages(code);
    // `kind != 'system'` with count() is not verified, so subtract instead.
    const [all, system, voice] = await Promise.all([
      this.count(messages),
      this.count(messages.where('kind', '==', 'system')),
      this.count(messages.where('attachment.voice.duration_ms', '>', 0)),
    ]);
    return { messageCount: Math.max(0, all - system), voiceCount: voice };
  }

  async attachmentStats(code: string): Promise<RoomAttachmentStats> {
    await this.quota.assertCan('reads');
    const stats: RoomAttachmentStats = { attachmentCount: 0, attachmentBytes: 0, voiceCount: 0, voiceBytes: 0 };
    const seen = new Set<string>();
    for (const field of ['attachments', 'attachment'] as const) {
      const q = this.messages(code)
        .where(field, '!=', null)
        .orderBy('created_at', 'desc')
        .select('attachment', 'attachments')
        .limit(STATS_MAX_DOCS);
      const snap = await guarded(this.quota, () => q.get());
      this.quota.record('reads', Math.max(1, snap.size));
      for (const doc of snap.docs) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        const parsed = chatMessageSchema.pick({ attachment: true, attachments: true }).safeParse(doc.data());
        if (!parsed.success) continue;
        for (const a of attachmentsOf(parsed.data)) {
          if (!isListedAttachment(a)) continue;
          stats.attachmentCount++;
          stats.attachmentBytes += a.size;
          if (a.voice) {
            stats.voiceCount++;
            stats.voiceBytes += a.size;
          }
        }
      }
    }
    return stats;
  }

  async close(code: string): Promise<RoomDeleteStats | null> {
    const snap = await guarded(this.quota, () => this.rooms().doc(code).get());
    this.quota.record('reads', 1);
    if (!snap.exists) return null;
    const result = await guarded(this.quota, () => this.deleter(code, this.db));
    if (result.docs) this.quota.record('deletes', result.docs);
    return result;
  }

  private rooms() {
    return this.db.collection(ROOMS_COLLECTION);
  }

  private messages(code: string) {
    return this.rooms().doc(code).collection(MESSAGES_SUBCOLLECTION);
  }

  private async count(q: Query): Promise<number> {
    await this.quota.assertCan('reads');
    const snap = await guarded(this.quota, () => q.count().get());
    const n = snap.data().count;
    this.quota.record('reads', readsForAggregation(n));
    return n;
  }
}

function toRoom(code: string, data: unknown): AdminRoom | null {
  const parsed = roomDoc.safeParse(data);
  if (!parsed.success) return null;
  const d = parsed.data;
  return {
    code,
    name: d.name,
    createdAt: d.created_at,
    expiresAt: d.expires_at,
    ttlHours: d.ttl_hours,
    createdBy: d.created_by,
    creatorTz: d.creator_tz,
  };
}
