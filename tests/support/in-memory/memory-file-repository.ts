import type { FileIdCodec } from '@/server/files/file-id';
import {
  attachmentRemoval,
  attachmentsOf,
  chatMessageSchema,
  chatRows,
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
import { mergePages, type MergeUnit } from '@/server/repositories/merge-pages';

type Raw = Record<string, unknown>;
type StoredMessage = { code: string; id: string; doc: Raw };

/**
 * In-memory FileReader + FileRemover for unit tests. Stores raw docs in the
 * same shapes as Firestore (`files/{token}`, `rooms/{code}/messages/{id}`)
 * and maps them with the same helpers, so the contract tests hold for both.
 * Cursors are offsets per source, merged with the same mergePages.
 */
export class MemoryFileRepository implements FileReader, FileRemover {
  readonly shares = new Map<string, Raw>();
  readonly messages: StoredMessage[] = [];

  constructor(private readonly ids: FileIdCodec) {}

  addShare(token: string, doc: Raw): void {
    this.shares.set(token, structuredClone(doc));
  }

  addMessage(code: string, id: string, doc: Raw): void {
    this.messages.push({ code, id, doc: structuredClone(doc) });
  }

  async list(query: FileListQuery, now: Date): Promise<FilePage> {
    const limit = Math.min(Math.max(Math.floor(query.limit), 1), 100);
    const kind = query.ownerUid || query.expired ? 'share' : query.roomCode ? 'chat' : (query.kind ?? 'all');
    const sources = [];
    if (kind !== 'chat') sources.push({ key: 's', fetch: offsetSource(this.shareUnits(query, now)) });
    if (kind !== 'share') {
      sources.push({ key: 'c', fetch: offsetSource(this.chatUnits('album', query.roomCode)) });
      sources.push({ key: 'l', fetch: offsetSource(this.chatUnits('single', query.roomCode)) });
    }
    const { rows, nextCursor } = await mergePages(sources, query.cursor, limit);
    return { files: rows, nextCursor };
  }

  async get(id: string): Promise<AdminFile | null> {
    const parsed = this.ids.decode(id);
    if (!parsed) return null;
    if (parsed.kind === 'share') {
      const doc = shareDocSchema.safeParse(this.shares.get(parsed.token));
      return doc.success ? shareRow(id, doc.data) : null;
    }
    const msg = this.findMessage(parsed.roomCode, parsed.messageId);
    const data = msg ? chatMessageSchema.safeParse(msg.doc) : null;
    if (!data?.success) return null;
    return chatRows(parsed.roomCode, data.data, this.chatIdOf(parsed.roomCode, parsed.messageId)).find((r) => r.id === id) ?? null;
  }

  async shareTotals(): Promise<StoredBytes> {
    return this.totals(() => true);
  }

  async ownerTotals(uid: string): Promise<StoredBytes> {
    return this.totals((d) => d.owner_id === uid);
  }

  async expiredOwnedTotals(now: Date): Promise<StoredBytes> {
    return this.totals((d) => d.owner_id != null && typeof d.expires_at === 'string' && d.expires_at < now.toISOString());
  }

  async storageKeyOf(id: string): Promise<string | null> {
    const parsed = this.ids.decode(id);
    if (!parsed) return null;
    if (parsed.kind === 'share') {
      const path = this.shares.get(parsed.token)?.file_path;
      return typeof path === 'string' ? path : null;
    }
    const msg = this.findMessage(parsed.roomCode, parsed.messageId);
    const data = msg ? chatMessageSchema.pick({ attachment: true, attachments: true }).safeParse(msg.doc) : null;
    if (!data?.success) return null;
    const target = attachmentsOf(data.data)[parsed.index];
    return target && !target.is_long_text && !target.removed_at ? target.key : null;
  }

  async removeRecord(id: string, removedAt: Date): Promise<boolean> {
    const parsed = this.ids.decode(id);
    if (!parsed) return false;
    if (parsed.kind === 'share') return this.shares.delete(parsed.token);
    const msg = this.findMessage(parsed.roomCode, parsed.messageId);
    if (!msg) return false;
    const removal = attachmentRemoval(msg.doc, parsed.index, removedAt.toISOString());
    if (!removal) return false;
    Object.assign(msg.doc, structuredClone(removal.update));
    return true;
  }

  private chatIdOf(roomCode: string, messageId: string) {
    return (index: number) => this.ids.encode({ kind: 'chat', roomCode, messageId, index });
  }

  private findMessage(code: string, id: string): StoredMessage | undefined {
    return this.messages.find((m) => m.code === code && m.id === id);
  }

  private totals(match: (d: Raw) => boolean): StoredBytes {
    let count = 0;
    let bytes = 0;
    for (const d of this.shares.values()) {
      if (!match(d)) continue;
      count++;
      bytes += typeof d.size === 'number' ? d.size : 0;
    }
    return { count, bytes };
  }

  private shareUnits(query: FileListQuery, now: Date): MergeUnit<AdminFile>[] {
    const nowIso = now.toISOString();
    const field = query.expired ? 'expires_at' : 'created_at';
    return [...this.shares.entries()]
      .filter(([, d]) => (query.ownerUid ? d.owner_id === query.ownerUid : true))
      .filter(([, d]) => (query.expired ? typeof d.expires_at === 'string' && d.expires_at < nowIso : true))
      .sort(([ta, a], [tb, b]) => {
        const order = String(a[field]).localeCompare(String(b[field])) || ta.localeCompare(tb);
        return query.expired ? order : -order;
      })
      .map(([token, d]) => {
        const parsed = shareDocSchema.safeParse(d);
        if (!parsed.success) return { sortKey: Number.NEGATIVE_INFINITY, rows: [], cursor: '' };
        const row = shareRow(this.ids.encode({ kind: 'share', token }), parsed.data);
        return { sortKey: query.expired ? -(row.expiresAt?.getTime() ?? 0) : row.createdAt.getTime(), rows: [row], cursor: '' };
      });
  }

  private chatUnits(source: 'album' | 'single', roomCode: string | undefined): MergeUnit<AdminFile>[] {
    const field = source === 'album' ? 'attachments' : 'attachment';
    return this.messages
      .filter((m) => (roomCode ? m.code === roomCode : true))
      .filter((m) => m.doc[field] !== null && m.doc[field] !== undefined)
      .sort((a, b) => String(b.doc.created_at).localeCompare(String(a.doc.created_at)) || b.id.localeCompare(a.id))
      .map((m) => {
        const parsed = chatMessageSchema.safeParse(m.doc);
        if (!parsed.success) return { sortKey: Number.NEGATIVE_INFINITY, rows: [], cursor: '' };
        const inAlbum = source === 'single' && (parsed.data.attachments?.length ?? 0) > 0;
        return {
          sortKey: parsed.data.created_at.getTime(),
          rows: inAlbum ? [] : chatRows(m.code, parsed.data, this.chatIdOf(m.code, m.id)),
          cursor: '',
        };
      });
  }
}

/** Pages a fixed, sorted unit list by offset (the cursor is the next offset). */
function offsetSource(all: MergeUnit<AdminFile>[]) {
  return async (cursor: string | null, limit: number) => {
    const start = cursor ? Number(cursor) : 0;
    const units = all.slice(start, start + limit).map((u, i) => ({ ...u, cursor: String(start + i + 1) }));
    return { units, done: start + limit >= all.length };
  };
}
