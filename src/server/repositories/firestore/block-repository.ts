import 'server-only';

import { FieldPath, FieldValue, Timestamp, type Firestore, type Query } from 'firebase-admin/firestore';
import { z } from 'zod';

import { BLOCK_REF_PATTERN, BLOCK_TYPES } from '@/shared/lib/block-values';
import {
  BLOCKLIST_FIELDS,
  emptyBlocklist,
  isLive,
  type BlocklistData,
  type BlocklistEntry,
  type BlocklistSnapshot,
} from '@/server/blocklist/types';
import { ADMIN_CONFIG_DOCS, COLLECTIONS } from '@/server/firestore/collections';
import { readsForAggregation, type QuotaMeter } from '@/server/quota/quota-guard';
import { toAuditDoc } from '@/server/repositories/firestore/audit-repository';
import type {
  BlockCreateResult,
  BlockListQuery,
  BlockPage,
  BlockRecord,
  BlockRemoveResult,
  BlockRepository,
  BlockStatus,
  BlockType,
  NewAuditEntry,
  NewBlock,
} from '@/server/repositories/interfaces';

const MAX_LIMIT = 100;
const SEARCH_LIMIT = 50;
/** `ends_at` for a block that never ends, so "active" is one range filter. */
const NEVER = Timestamp.fromDate(new Date('9999-12-31T00:00:00.000Z'));

/**
 * Block ids: 20 chars from a 32-letter alphabet without I, L, O, U, so the
 * 6-char ref prefix is easy to read out and is upper case like the ref.
 */
const ID_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
export function newBlockId(): string {
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ID_ALPHABET[b & 31]).join('');
}

// --- Parsing (lenient on optional fields, strict on what enforcement needs)

const entrySchema = z.object({
  id: z.string().min(1),
  value: z.string().min(1),
  expires_at: z.number().nullable().catch(null),
});
const entryList = z
  .array(z.unknown())
  .catch([])
  .transform((items) =>
    items.flatMap((item): BlocklistEntry[] => {
      const parsed = entrySchema.safeParse(item);
      return parsed.success ? [{ id: parsed.data.id, value: parsed.data.value, expiresAt: parsed.data.expires_at }] : [];
    }),
  );
const blocklistDoc = z.object({
  ips: entryList.optional(),
  cidrs: entryList.optional(),
  countries: entryList.optional(),
  uids: entryList.optional(),
  devices: entryList.optional(),
  version: z.number().int().nonnegative().catch(0).optional(),
});

export function parseBlocklist(data: unknown): BlocklistData {
  const parsed = blocklistDoc.safeParse(data ?? {});
  if (!parsed.success) return emptyBlocklist();
  const d = parsed.data;
  return {
    ips: d.ips ?? [],
    cidrs: d.cidrs ?? [],
    countries: d.countries ?? [],
    uids: d.uids ?? [],
    devices: d.devices ?? [],
    version: d.version ?? 0,
  };
}

const nullableString = z.string().nullish().catch(null).transform((v) => v ?? null);
const nullableTimestamp = z.instanceof(Timestamp).nullish().catch(null).transform((v) => v ?? null);
const blockDoc = z.object({
  type: z.enum(BLOCK_TYPES),
  value: z.string(),
  reason: z.string().catch(''),
  created_by: z.string().catch(''),
  created_by_email: nullableString,
  created_at: z.instanceof(Timestamp),
  expires_at: nullableTimestamp,
  removed_at: nullableTimestamp,
  removed_by: nullableString,
  hits: z.number().nonnegative().catch(0).optional(),
});

function toRecord(id: string, data: unknown): BlockRecord | null {
  const parsed = blockDoc.safeParse(data);
  if (!parsed.success) return null;
  const d = parsed.data;
  return {
    id,
    type: d.type,
    value: d.value,
    reason: d.reason,
    createdBy: d.created_by,
    createdByEmail: d.created_by_email,
    createdAt: d.created_at.toDate(),
    expiresAt: d.expires_at?.toDate() ?? null,
    removedAt: d.removed_at?.toDate() ?? null,
    removedBy: d.removed_by,
    hits: d.hits ?? 0,
  };
}

function toBlockDoc(block: BlockRecord) {
  const expires = block.expiresAt ? Timestamp.fromDate(block.expiresAt) : null;
  return {
    type: block.type,
    value: block.value,
    reason: block.reason,
    created_by: block.createdBy,
    created_by_email: block.createdByEmail,
    created_at: Timestamp.fromDate(block.createdAt),
    expires_at: expires,
    removed_at: block.removedAt ? Timestamp.fromDate(block.removedAt) : null,
    removed_by: block.removedBy,
    hits: block.hits,
    // Query helpers: "active" = !removed && ends_at > now (one range filter).
    removed: block.removedAt !== null,
    ends_at: expires ?? NEVER,
  };
}

function toEntryDoc(block: BlockRecord) {
  return { id: block.id, value: block.value, expires_at: block.expiresAt ? block.expiresAt.getTime() : null };
}

function entriesToDocs(entries: BlocklistEntry[]) {
  return entries.map((e) => ({ id: e.id, value: e.value, expires_at: e.expiresAt }));
}

export function statusOf(block: Pick<BlockRecord, 'removedAt' | 'expiresAt'>, now: Date): BlockStatus {
  if (block.removedAt) return 'removed';
  if (block.expiresAt && block.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'active';
}

// --- Cursor: base64url("<ms>.<id>") of the order field

function encodeCursor(ms: number, id: string): string {
  return Buffer.from(`${ms}.${id}`).toString('base64url');
}

function decodeCursor(cursor: string | null | undefined): { at: Timestamp; id: string } | null {
  if (!cursor) return null;
  const match = /^(\d+)\.([A-Za-z0-9]+)$/.exec(Buffer.from(cursor, 'base64url').toString());
  if (!match) return null;
  return { at: Timestamp.fromMillis(Number(match[1])), id: match[2] };
}

/**
 * `blocks/{id}` + `admin_config/blocklist` on Firestore.
 *
 * Quota (reported to QuotaGuard): readBlocklist = 2 reads (blocklist +
 * settings, always allowed). create = 1 read + 3 writes; remove = 2 reads +
 * 3 writes (writes always allowed, hard rule 4 needs the audit row).
 * list = 1 read per row (min 1), count = 1 per 1,000 entries, get = 1; these
 * three refuse at the read cap. addHits = 1 write per block. sweepExpired =
 * 1 read + 0 or 1 write.
 */
export class FirestoreBlockRepository implements BlockRepository {
  constructor(
    private readonly db: Firestore,
    private readonly quota: QuotaMeter,
  ) {}

  private get blocks() {
    return this.db.collection(COLLECTIONS.blocks);
  }

  private get blocklistRef() {
    return this.db.collection(COLLECTIONS.adminConfig).doc(ADMIN_CONFIG_DOCS.blocklist);
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.quota.noteError(error);
      throw error;
    }
  }

  async readBlocklist(): Promise<BlocklistSnapshot> {
    const settingsRef = this.db.collection(COLLECTIONS.adminConfig).doc(ADMIN_CONFIG_DOCS.settings);
    const [list, settings] = await this.run(() => this.db.getAll(this.blocklistRef, settingsRef));
    // Security reads: counted, never blocked.
    this.quota.record('reads', 2);
    return { blocklist: parseBlocklist(list.data()), settings: (settings.data() as Record<string, unknown>) ?? null };
  }

  async addHits(hits: ReadonlyMap<string, number>): Promise<void> {
    if (hits.size === 0) return;
    const batch = this.db.batch();
    for (const [id, n] of hits) batch.update(this.blocks.doc(id), { hits: FieldValue.increment(n) });
    await this.run(() => batch.commit());
    this.quota.record('writes', hits.size);
  }

  async create(block: NewBlock, audit: (stored: BlockRecord) => NewAuditEntry, now: Date): Promise<BlockCreateResult> {
    const id = newBlockId();
    const blockRef = this.blocks.doc(id);
    const auditRef = this.db.collection(COLLECTIONS.adminAudit).doc();
    const field = BLOCKLIST_FIELDS[block.type];
    const nowMs = now.getTime();

    const result = await this.run(() =>
      this.db.runTransaction(async (tx): Promise<BlockCreateResult> => {
        const list = parseBlocklist((await tx.get(this.blocklistRef)).data());
        const duplicate = list[field].find((e) => e.value === block.value && isLive(e, nowMs));
        if (duplicate) {
          return {
            ok: false,
            reason: 'duplicate',
            existing: { id: duplicate.id, expiresAt: duplicate.expiresAt === null ? null : new Date(duplicate.expiresAt) },
          };
        }
        const stored: BlockRecord = { ...block, id, createdAt: now, removedAt: null, removedBy: null, hits: 0 };
        tx.set(blockRef, toBlockDoc(stored));
        tx.set(
          this.blocklistRef,
          {
            [field]: [...entriesToDocs(list[field].filter((e) => isLive(e, nowMs))), toEntryDoc(stored)],
            version: list.version + 1,
            updated_at: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        tx.set(auditRef, toAuditDoc(audit(stored)));
        return { ok: true, block: stored };
      }),
    );
    this.quota.record('reads', 1);
    if (result.ok) this.quota.record('writes', 3);
    return result;
  }

  async remove(
    id: string,
    removedBy: string,
    audit: (before: BlockRecord, after: BlockRecord) => NewAuditEntry,
    now: Date,
  ): Promise<BlockRemoveResult> {
    const blockRef = this.blocks.doc(id);
    const auditRef = this.db.collection(COLLECTIONS.adminAudit).doc();
    const nowMs = now.getTime();

    const result = await this.run(() =>
      this.db.runTransaction(async (tx): Promise<BlockRemoveResult> => {
        const [snap, listSnap] = await tx.getAll(blockRef, this.blocklistRef);
        const before = snap.exists ? toRecord(snap.id, snap.data()) : null;
        if (!before) return { ok: false, reason: 'not_found' };
        if (before.removedAt) return { ok: false, reason: 'already_removed' };
        const after: BlockRecord = { ...before, removedAt: now, removedBy };
        const list = parseBlocklist(listSnap.data());
        const field = BLOCKLIST_FIELDS[before.type];
        tx.update(blockRef, { removed_at: Timestamp.fromDate(now), removed_by: removedBy, removed: true });
        tx.set(
          this.blocklistRef,
          {
            [field]: entriesToDocs(list[field].filter((e) => e.id !== id && isLive(e, nowMs))),
            version: list.version + 1,
            updated_at: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        tx.set(auditRef, toAuditDoc(audit(before, after)));
        return { ok: true, block: after };
      }),
    );
    this.quota.record('reads', 2);
    if (result.ok) this.quota.record('writes', 3);
    return result;
  }

  async get(id: string): Promise<BlockRecord | null> {
    await this.quota.assertCan('reads');
    const snap = await this.run(() => this.blocks.doc(id).get());
    this.quota.record('reads', 1);
    return snap.exists ? toRecord(snap.id, snap.data()) : null;
  }

  private filtered(status: BlockStatus, now: Date, type?: BlockType): Query {
    let q: Query = this.blocks.where('removed', '==', status === 'removed');
    if (type) q = q.where('type', '==', type);
    const at = Timestamp.fromDate(now);
    if (status === 'active') return q.where('ends_at', '>', at);
    if (status === 'expired') return q.where('ends_at', '<=', at);
    return q;
  }

  async list(query: BlockListQuery): Promise<BlockPage> {
    await this.quota.assertCan('reads');
    const limit = Math.min(Math.max(Math.floor(query.limit), 1), MAX_LIMIT);
    if (query.q) return this.search(query);

    let q = this.filtered(query.status, query.now, query.type);
    const orderField = query.status === 'removed' ? 'removed_at' : 'ends_at';
    // Active: ending soonest first ("Never" last). Expired / removed: newest first.
    const direction = query.status === 'active' ? 'asc' : 'desc';
    q = q.orderBy(orderField, direction).orderBy(FieldPath.documentId(), direction);
    const cursor = decodeCursor(query.cursor);
    if (cursor) q = q.startAfter(cursor.at, cursor.id);

    const snap = await this.run(() => q.limit(limit).get());
    this.quota.record('reads', Math.max(1, snap.size));
    const blocks: BlockRecord[] = [];
    let last: { ms: number; id: string } | null = null;
    for (const doc of snap.docs) {
      const record = toRecord(doc.id, doc.data());
      const order = doc.get(orderField);
      if (order instanceof Timestamp) last = { ms: order.toMillis(), id: doc.id };
      if (record) blocks.push(record);
    }
    const nextCursor = last && snap.size === limit ? encodeCursor(last.ms, last.id) : null;
    return { blocks, nextCursor };
  }

  /** Value (exact) or ref search, all statuses read, filtered in memory. Small by design: no paging. */
  private async search(query: BlockListQuery): Promise<BlockPage> {
    const text = (query.q ?? '').trim();
    const ref = BLOCK_REF_PATTERN.exec(text);
    const q: Query = ref
      ? this.blocks
          .where(FieldPath.documentId(), '>=', ref[1].toUpperCase())
          .where(FieldPath.documentId(), '<', `${ref[1].toUpperCase()}`)
      : this.blocks.where('value', '==', text);
    const snap = await this.run(() => q.limit(SEARCH_LIMIT).get());
    this.quota.record('reads', Math.max(1, snap.size));
    const blocks = snap.docs
      .map((doc) => toRecord(doc.id, doc.data()))
      .filter((b): b is BlockRecord => b !== null)
      .filter((b) => statusOf(b, query.now) === query.status && (!query.type || b.type === query.type))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, Math.min(Math.max(Math.floor(query.limit), 1), MAX_LIMIT));
    return { blocks, nextCursor: null };
  }

  async count(status: BlockStatus, now: Date, type?: BlockType): Promise<number> {
    await this.quota.assertCan('reads');
    const snap = await this.run(() => this.filtered(status, now, type).count().get());
    const total = snap.data().count;
    this.quota.record('reads', readsForAggregation(total));
    return total;
  }

  async sweepExpired(now: Date): Promise<number> {
    const nowMs = now.getTime();
    const removed = await this.run(() =>
      this.db.runTransaction(async (tx) => {
        const list = parseBlocklist((await tx.get(this.blocklistRef)).data());
        const update: Record<string, unknown> = {};
        let dropped = 0;
        for (const field of Object.values(BLOCKLIST_FIELDS)) {
          const live = list[field].filter((e) => isLive(e, nowMs));
          if (live.length !== list[field].length) {
            dropped += list[field].length - live.length;
            update[field] = entriesToDocs(live);
          }
        }
        if (dropped > 0) {
          tx.set(
            this.blocklistRef,
            { ...update, version: list.version + 1, updated_at: FieldValue.serverTimestamp() },
            { merge: true },
          );
        }
        return dropped;
      }),
    );
    this.quota.record('reads', 1);
    if (removed > 0) this.quota.record('writes', 1);
    return removed;
  }
}
