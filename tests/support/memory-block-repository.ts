import { emptyBlocklist, isLive, BLOCKLIST_FIELDS, type BlocklistData, type BlocklistSnapshot } from '@/server/blocklist/types';
import { statusOf } from '@/server/repositories/firestore/block-repository';
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
import { BLOCK_REF_PATTERN } from '@/shared/lib/block-values';

const NEVER = Date.UTC(9999, 11, 31);

/**
 * In-memory BlockRepository for unit tests. Same rules as the Firestore one:
 * duplicate check against live blocklist entries, all-or-nothing writes
 * (block + blocklist + audit row), same list order and cursor paging.
 * `audit` holds the rows a transaction would have written.
 */
export class MemoryBlockRepository implements BlockRepository {
  readonly blocks = new Map<string, BlockRecord>();
  blocklist: BlocklistData = emptyBlocklist();
  settings: Record<string, unknown> | null = null;
  readonly audit: NewAuditEntry[] = [];
  readonly hits = new Map<string, number>();
  reads = 0;
  private seq = 0;
  /** Set to make the next write fail before anything is stored. */
  failNextWrite = false;

  async readBlocklist(): Promise<BlocklistSnapshot> {
    this.reads += 1;
    return { blocklist: structuredClone(this.blocklist), settings: this.settings };
  }

  async addHits(hits: ReadonlyMap<string, number>): Promise<void> {
    for (const [id, n] of hits) {
      this.hits.set(id, (this.hits.get(id) ?? 0) + n);
      const block = this.blocks.get(id);
      if (block) block.hits += n;
    }
  }

  private checkFail() {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('write failed');
    }
  }

  async create(block: NewBlock, audit: (stored: BlockRecord) => NewAuditEntry, now: Date): Promise<BlockCreateResult> {
    const field = BLOCKLIST_FIELDS[block.type];
    const dup = this.blocklist[field].find((e) => e.value === block.value && isLive(e, now.getTime()));
    if (dup) {
      return { ok: false, reason: 'duplicate', existing: { id: dup.id, expiresAt: dup.expiresAt === null ? null : new Date(dup.expiresAt) } };
    }
    this.checkFail();
    this.seq += 1;
    const id = `B${String(this.seq).padStart(5, '0')}MEMORYBLOCK00`;
    const stored: BlockRecord = { ...block, id, createdAt: now, removedAt: null, removedBy: null, hits: 0 };
    const row = audit(stored);
    this.blocks.set(id, structuredClone(stored));
    this.blocklist = {
      ...this.blocklist,
      [field]: [
        ...this.blocklist[field].filter((e) => isLive(e, now.getTime())),
        { id, value: stored.value, expiresAt: stored.expiresAt?.getTime() ?? null },
      ],
      version: this.blocklist.version + 1,
    };
    this.audit.push(row);
    return { ok: true, block: structuredClone(stored) };
  }

  async remove(
    id: string,
    removedBy: string,
    audit: (before: BlockRecord, after: BlockRecord) => NewAuditEntry,
    now: Date,
  ): Promise<BlockRemoveResult> {
    const before = this.blocks.get(id);
    if (!before) return { ok: false, reason: 'not_found' };
    if (before.removedAt) return { ok: false, reason: 'already_removed' };
    this.checkFail();
    const after: BlockRecord = { ...before, removedAt: now, removedBy };
    const row = audit(structuredClone(before), structuredClone(after));
    const field = BLOCKLIST_FIELDS[before.type];
    this.blocks.set(id, after);
    this.blocklist = {
      ...this.blocklist,
      [field]: this.blocklist[field].filter((e) => e.id !== id && isLive(e, now.getTime())),
      version: this.blocklist.version + 1,
    };
    this.audit.push(row);
    return { ok: true, block: structuredClone(after) };
  }

  async get(id: string): Promise<BlockRecord | null> {
    const b = this.blocks.get(id);
    return b ? structuredClone(b) : null;
  }

  private matching(status: BlockStatus, now: Date, type?: BlockType): BlockRecord[] {
    return [...this.blocks.values()].filter((b) => statusOf(b, now) === status && (!type || b.type === type));
  }

  async list(query: BlockListQuery): Promise<BlockPage> {
    const limit = Math.min(Math.max(Math.floor(query.limit), 1), 100);
    if (query.q) {
      const ref = BLOCK_REF_PATTERN.exec(query.q);
      const found = [...this.blocks.values()]
        .filter((b) => (ref ? b.id.startsWith(ref[1].toUpperCase()) : b.value === query.q))
        .filter((b) => statusOf(b, query.now) === query.status && (!query.type || b.type === query.type))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { blocks: found.slice(0, limit).map((b) => structuredClone(b)), nextCursor: null };
    }
    const asc = query.status === 'active';
    const key = (b: BlockRecord) =>
      query.status === 'removed' ? (b.removedAt?.getTime() ?? 0) : (b.expiresAt?.getTime() ?? NEVER);
    const sorted = this.matching(query.status, query.now, query.type).sort((a, b) => {
      const d = key(a) - key(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      return asc ? d : -d;
    });
    let start = 0;
    if (query.cursor) {
      const [ms, id] = Buffer.from(query.cursor, 'base64url').toString().split('.');
      start = sorted.findIndex((b) => key(b) === Number(ms) && b.id === id) + 1;
    }
    const page = sorted.slice(start, start + limit);
    const last = page.at(-1);
    const nextCursor = last && page.length === limit ? Buffer.from(`${key(last)}.${last.id}`).toString('base64url') : null;
    return { blocks: page.map((b) => structuredClone(b)), nextCursor };
  }

  async count(status: BlockStatus, now: Date, type?: BlockType): Promise<number> {
    return this.matching(status, now, type).length;
  }

  async sweepExpired(now: Date): Promise<number> {
    let dropped = 0;
    const next = { ...this.blocklist };
    for (const field of Object.values(BLOCKLIST_FIELDS)) {
      const live = this.blocklist[field].filter((e) => isLive(e, now.getTime()));
      dropped += this.blocklist[field].length - live.length;
      next[field] = live;
    }
    if (dropped > 0) this.blocklist = { ...next, version: next.version + 1 };
    return dropped;
  }
}
