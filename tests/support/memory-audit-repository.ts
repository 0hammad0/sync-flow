import type {
  AuditEntry,
  AuditListQuery,
  AuditPage,
  AuditRepository,
  NewAuditEntry,
} from '@/server/repositories/interfaces';

/**
 * In-memory AuditRepository for unit tests. Same ordering and paging rules as
 * the Firestore one (at desc, then id desc; cursor after the last row; a full
 * page always returns a cursor). Ids grow with each append, so rows written in
 * the same millisecond still list newest first.
 */
export class MemoryAuditRepository implements AuditRepository {
  private readonly rows: AuditEntry[] = [];
  private seq = 0;

  constructor(private readonly now: () => number = Date.now) {}

  async append(entry: NewAuditEntry): Promise<string> {
    this.seq += 1;
    const id = `mem-${String(this.seq).padStart(8, '0')}`;
    this.rows.push(structuredClone({ ...entry, id, at: new Date(this.now()) }));
    return id;
  }

  async list(query: AuditListQuery): Promise<AuditPage> {
    const limit = Math.min(Math.max(Math.floor(query.limit), 1), 100);
    const cursor = decodeCursor(query.cursor);
    const matches = this.rows
      .filter((r) => (query.actorUid ? r.actorUid === query.actorUid : true))
      .filter((r) => (query.action ? r.action === query.action : true))
      .filter((r) => (query.targetId ? r.targetId === query.targetId : true))
      .filter((r) => (query.from ? r.at.getTime() >= query.from.getTime() : true))
      .filter((r) => (query.to ? r.at.getTime() < query.to.getTime() : true))
      .sort(newestFirst)
      .filter((r) => (cursor ? newestFirst(r, cursor) > 0 : true));
    const entries = matches.slice(0, limit).map((r) => structuredClone(r));
    const last = entries.at(-1);
    const nextCursor = last && entries.length === limit ? encodeCursor(last) : null;
    return { entries, nextCursor };
  }
}

type CursorKey = { at: Date; id: string };

function newestFirst(a: CursorKey, b: CursorKey): number {
  const byTime = b.at.getTime() - a.at.getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function encodeCursor(row: CursorKey): string {
  return Buffer.from(`${row.at.getTime()}.${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string | null | undefined): CursorKey | null {
  if (!cursor) return null;
  const match = /^(\d+)\.(.+)$/.exec(Buffer.from(cursor, 'base64url').toString());
  return match ? { at: new Date(Number(match[1])), id: match[2] } : null;
}
