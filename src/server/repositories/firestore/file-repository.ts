import 'server-only';

import {
  AggregateField,
  FieldPath,
  type DocumentSnapshot,
  type Firestore,
  type Query,
} from 'firebase-admin/firestore';
import { z } from 'zod';

import { readsForAggregation, type QuotaMeter } from '@/server/quota/quota-guard';
import {
  CHAT_FILE_FIELDS,
  attachmentRemoval,
  attachmentsOf,
  chatMessageSchema,
  chatRows,
  parseFileId,
  shareDocSchema,
  shareRow,
} from '@/server/repositories/admin-files';
import type {
  AdminFile,
  FileListQuery,
  FilePage,
  FileReader,
  FileRemover,
  StoredBytes,
} from '@/server/repositories/interfaces';
import { mergePages, type MergeSource, type MergeUnit } from '@/server/repositories/merge-pages';
import { MESSAGES_SUBCOLLECTION, ROOMS_COLLECTION } from '@/shared/lib/firebase/chat';
import { FILES_COLLECTION } from '@/shared/lib/firebase/files';
import { decodeJsonCursor, encodeJsonCursor, guarded, isNotFound } from './quota-call';

const MAX_LIMIT = 100;
/** Fields a chat paging cursor needs from the last message (never `content`). */
const CHAT_CURSOR_FIELDS = ['created_at', 'attachment', 'attachments'];

const shareCursor = z.object({ v: z.string(), id: z.string() });
const chatCursor = z.object({ p: z.string(), t: z.string() });

/**
 * Share files (`files`) and chat attachments (`rooms/{code}/messages`) as one
 * metadata list (docs/admin/03-features/09-files-and-storage.md).
 *
 * D-4: chat messages are only ever read through `.select(CHAT_FILE_FIELDS)`
 * or `fieldMask`, so `content` never leaves Firestore. Long-text bodies and
 * removed attachments are not rows.
 *
 * Quota (all reads refuse with QuotaExceededError at the read cap):
 * - list: up to `limit` docs per source (share, chat album, chat single) +
 *   1 read per chat source to resume from its cursor. Minimum 1 per query.
 * - get / storageKeyOf: 1 read. Aggregates: 1 read per 1,000 entries.
 * - removeRecord: share = 1 delete; chat = 1 read + 1 write (transaction).
 *   Admin deletes are counted, never blocked.
 *
 * Indexes: chat queries are collection-group (or one room) with `!= null`
 * filters ordered by `created_at desc`. See firestore.indexes.json.
 */
export class FirestoreFileRepository implements FileReader, FileRemover {
  constructor(
    private readonly db: Firestore,
    private readonly quota: QuotaMeter,
  ) {}

  async list(query: FileListQuery, now: Date): Promise<FilePage> {
    await this.quota.assertCan('reads');
    const limit = clampLimit(query.limit);
    const kind = query.ownerUid || query.expired ? 'share' : query.roomCode ? 'chat' : (query.kind ?? 'all');

    const sources: MergeSource<AdminFile>[] = [];
    if (kind !== 'chat') sources.push({ key: 's', fetch: (c, n) => this.shareUnits(query, now, c, n) });
    if (kind !== 'share') {
      sources.push({ key: 'c', fetch: (c, n) => this.chatUnits('album', query.roomCode, c, n) });
      sources.push({ key: 'l', fetch: (c, n) => this.chatUnits('single', query.roomCode, c, n) });
    }
    const { rows, nextCursor } = await mergePages(sources, query.cursor, limit);
    return { files: rows, nextCursor };
  }

  async get(id: string): Promise<AdminFile | null> {
    const parsed = parseFileId(id);
    if (!parsed) return null;
    await this.quota.assertCan('reads');
    if (parsed.kind === 'share') {
      const snap = await this.read(() => this.db.collection(FILES_COLLECTION).doc(parsed.token).get());
      const doc = snap.exists ? shareDocSchema.safeParse(snap.data()) : null;
      return doc?.success ? shareRow(parsed.token, doc.data) : null;
    }
    const snap = await this.readMessage(parsed.roomCode, parsed.messageId, [...CHAT_FILE_FIELDS]);
    const msg = snap.exists ? chatMessageSchema.safeParse(snap.data()) : null;
    if (!msg?.success) return null;
    return chatRows(parsed.roomCode, parsed.messageId, msg.data).find((r) => r.id === id) ?? null;
  }

  shareTotals(): Promise<StoredBytes> {
    return this.totals(this.db.collection(FILES_COLLECTION));
  }

  ownerTotals(uid: string): Promise<StoredBytes> {
    return this.totals(this.db.collection(FILES_COLLECTION).where('owner_id', '==', uid));
  }

  expiredOwnedTotals(now: Date): Promise<StoredBytes> {
    return this.totals(
      this.db
        .collection(FILES_COLLECTION)
        .where('owner_id', '!=', null)
        .where('expires_at', '<', now.toISOString()),
    );
  }

  async storageKeyOf(id: string): Promise<string | null> {
    const parsed = parseFileId(id);
    if (!parsed) return null;
    await this.quota.assertCan('reads');
    if (parsed.kind === 'share') {
      const snap = await this.read(() => this.db.collection(FILES_COLLECTION).doc(parsed.token).get());
      const path = snap.exists ? (snap.get('file_path') as unknown) : null;
      return typeof path === 'string' && path ? path : null;
    }
    const snap = await this.readMessage(parsed.roomCode, parsed.messageId, ['attachment', 'attachments']);
    const msg = snap.exists ? chatMessageSchema.pick({ attachment: true, attachments: true }).safeParse(snap.data()) : null;
    if (!msg?.success) return null;
    const target = attachmentsOf(msg.data)[parsed.index];
    return target && !target.is_long_text && !target.removed_at ? target.key : null;
  }

  async removeRecord(id: string, removedAt: Date): Promise<boolean> {
    const parsed = parseFileId(id);
    if (!parsed) return false;
    if (parsed.kind === 'share') {
      try {
        // Precondition: a missing doc fails with NOT_FOUND instead of a silent no-op.
        await this.db.collection(FILES_COLLECTION).doc(parsed.token).delete({ exists: true });
      } catch (error) {
        if (isNotFound(error)) {
          this.quota.record('deletes', 1);
          return false;
        }
        this.quota.noteError(error);
        throw error;
      }
      this.quota.record('deletes', 1);
      return true;
    }

    const ref = this.messageRef(parsed.roomCode, parsed.messageId);
    const removed = await guarded(this.quota, () =>
      this.db.runTransaction(async (tx) => {
        const [snap] = await tx.getAll(ref, { fieldMask: ['attachment', 'attachments'] });
        if (!snap.exists) return false;
        const removal = attachmentRemoval(snap.data() ?? {}, parsed.index, removedAt.toISOString());
        if (!removal) return false;
        // Only the attachment fields change. `content` is neither read nor written.
        tx.update(ref, removal.update);
        return true;
      }),
    );
    this.quota.record('reads', 1);
    if (removed) this.quota.record('writes', 1);
    return removed;
  }

  // --- sources -------------------------------------------------------------

  private async shareUnits(
    query: FileListQuery,
    now: Date,
    cursor: string | null,
    limit: number,
  ): Promise<{ units: MergeUnit<AdminFile>[]; done: boolean }> {
    let q: Query = this.db.collection(FILES_COLLECTION);
    if (query.ownerUid) q = q.where('owner_id', '==', query.ownerUid);
    // Expired: oldest expiry first. Otherwise newest first.
    const field = query.expired ? 'expires_at' : 'created_at';
    const dir = query.expired ? 'asc' : 'desc';
    if (query.expired) q = q.where('expires_at', '<', now.toISOString());
    q = q.orderBy(field, dir).orderBy(FieldPath.documentId(), dir);
    const at = shareCursor.safeParse(decodeJsonCursor(cursor));
    if (at.success) q = q.startAfter(at.data.v, at.data.id);

    const snap = await this.read(() => q.limit(limit).get(), true);
    const units: MergeUnit<AdminFile>[] = [];
    for (const doc of snap.docs) {
      const parsed = shareDocSchema.safeParse(doc.data());
      const raw = doc.get(field) as unknown;
      const next = encodeJsonCursor({ v: typeof raw === 'string' ? raw : '', id: doc.id });
      if (!parsed.success) {
        units.push({ sortKey: Number.NEGATIVE_INFINITY, rows: [], cursor: next });
        continue;
      }
      const row = shareRow(doc.id, parsed.data);
      const time = query.expired ? -(row.expiresAt?.getTime() ?? 0) : row.createdAt.getTime();
      units.push({ sortKey: time, rows: [row], cursor: next });
    }
    return { units, done: snap.size < limit };
  }

  /**
   * `album`: messages with `attachments` (albums, and one-file sends from the
   * messages route, which also fill `attachment`). `single`: messages with
   * `attachment` (voice notes, ticket uploads, older messages). Messages in
   * both are listed by `album` only.
   */
  private async chatUnits(
    source: 'album' | 'single',
    roomCode: string | undefined,
    cursor: string | null,
    limit: number,
  ): Promise<{ units: MergeUnit<AdminFile>[]; done: boolean }> {
    const base: Query = roomCode
      ? this.db.collection(ROOMS_COLLECTION).doc(roomCode).collection(MESSAGES_SUBCOLLECTION)
      : this.db.collectionGroup(MESSAGES_SUBCOLLECTION);
    let q = base
      .where(source === 'album' ? 'attachments' : 'attachment', '!=', null)
      .orderBy('created_at', 'desc')
      .select(...CHAT_FILE_FIELDS);

    const at = chatCursor.safeParse(decodeJsonCursor(cursor));
    if (at.success) {
      const [last] = await this.read(() =>
        this.db.getAll(this.db.doc(at.data.p), { fieldMask: CHAT_CURSOR_FIELDS }),
      );
      // The last message may be gone (room closed): resume by time instead.
      q = last.exists ? q.startAfter(last) : q.startAfter(at.data.t);
    }

    const snap = await this.read(() => q.limit(limit).get(), true);
    const units: MergeUnit<AdminFile>[] = [];
    for (const doc of snap.docs) {
      const createdAt = doc.get('created_at') as unknown;
      const next = encodeJsonCursor({ p: doc.ref.path, t: typeof createdAt === 'string' ? createdAt : '' });
      const parsed = chatMessageSchema.safeParse(doc.data());
      const code = doc.ref.parent.parent?.id;
      const inAlbum = source === 'single' && parsed.success && (parsed.data.attachments?.length ?? 0) > 0;
      if (!parsed.success || !code || inAlbum) {
        units.push({ sortKey: parsed.success ? parsed.data.created_at.getTime() : Number.NEGATIVE_INFINITY, rows: [], cursor: next });
        continue;
      }
      units.push({ sortKey: parsed.data.created_at.getTime(), rows: chatRows(code, doc.id, parsed.data), cursor: next });
    }
    return { units, done: snap.size < limit };
  }

  // --- helpers -------------------------------------------------------------

  private messageRef(roomCode: string, messageId: string) {
    return this.db.collection(ROOMS_COLLECTION).doc(roomCode).collection(MESSAGES_SUBCOLLECTION).doc(messageId);
  }

  private async readMessage(roomCode: string, messageId: string, fields: string[]): Promise<DocumentSnapshot> {
    const [snap] = await this.read(() => this.db.getAll(this.messageRef(roomCode, messageId), { fieldMask: fields }));
    return snap;
  }

  /** Runs a read and counts it: 1 per doc returned, minimum 1. */
  private async read<T extends DocumentSnapshot | DocumentSnapshot[] | { size: number }>(
    call: () => Promise<T>,
    isQuery = false,
  ): Promise<T> {
    const result = await guarded(this.quota, call);
    const n = isQuery ? (result as { size: number }).size : Array.isArray(result) ? result.length : 1;
    this.quota.record('reads', Math.max(1, n));
    return result;
  }

  private async totals(q: Query): Promise<StoredBytes> {
    await this.quota.assertCan('reads');
    const snap = await guarded(this.quota, () =>
      q.aggregate({ count: AggregateField.count(), bytes: AggregateField.sum('size') }).get(),
    );
    const count = snap.data().count;
    this.quota.record('reads', readsForAggregation(count));
    return { count, bytes: Number(snap.data().bytes ?? 0) };
  }
}

function clampLimit(limit: number): number {
  return Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
}
