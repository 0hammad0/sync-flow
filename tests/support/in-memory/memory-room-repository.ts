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

type Raw = Record<string, unknown>;
type StoredRoom = { doc: Raw; messages: Map<string, Raw>; presence: Map<string, Raw>; objects: Map<string, number> };

/**
 * In-memory RoomReader + RoomCloser. Rooms hold raw docs like Firestore
 * (`rooms/{code}` + messages + presence) and an R2 stand-in (`objects`,
 * key → size) so close() can report what it removed. `log` records the
 * delete order: storage first, then docs.
 */
export class MemoryRoomRepository implements RoomReader, RoomCloser {
  readonly rooms = new Map<string, StoredRoom>();
  readonly log: string[] = [];

  addRoom(code: string, doc: Raw): void {
    this.rooms.set(code, { doc: structuredClone(doc), messages: new Map(), presence: new Map(), objects: new Map() });
  }

  addMessage(code: string, id: string, doc: Raw): void {
    this.room(code).messages.set(id, structuredClone(doc));
  }

  addPresence(code: string, deviceId: string, lastSeen: string): void {
    this.room(code).presence.set(deviceId, { device_id: deviceId, last_seen: lastSeen });
  }

  addObject(code: string, key: string, size: number): void {
    this.room(code).objects.set(key, size);
  }

  async list(query: RoomListQuery, now: Date): Promise<RoomPage> {
    const limit = Math.min(Math.max(Math.floor(query.limit), 1), 100);
    const status = query.status ?? 'live';
    const nowIso = now.toISOString();
    const soon = new Date(now.getTime() + 3_600_000).toISOString();
    const all = [...this.rooms.entries()]
      .map(([code, r]) => toRoom(code, r.doc))
      .filter((r): r is AdminRoom => r !== null)
      .filter((r) => (query.ttlHours ? r.ttlHours === query.ttlHours : true))
      .filter((r) => (status === 'all' ? true : r.expiresAt.toISOString() > nowIso))
      .filter((r) => (status === 'expiring' ? r.expiresAt.toISOString() < soon : true))
      .sort((a, b) =>
        status === 'all'
          ? b.createdAt.getTime() - a.createdAt.getTime() || b.code.localeCompare(a.code)
          : a.expiresAt.getTime() - b.expiresAt.getTime() || a.code.localeCompare(b.code),
      );
    const start = query.cursor ? Number(query.cursor) : 0;
    const rooms = all.slice(start, start + limit);
    return { rooms, nextCursor: rooms.length === limit ? String(start + limit) : null };
  }

  async get(code: string): Promise<AdminRoom | null> {
    const r = this.rooms.get(code);
    return r ? toRoom(code, r.doc) : null;
  }

  async onlineCount(code: string, since: Date): Promise<number> {
    const r = this.rooms.get(code);
    if (!r) return 0;
    return [...r.presence.values()].filter((p) => String(p.last_seen) > since.toISOString()).length;
  }

  async counts(code: string): Promise<RoomCounts> {
    const msgs = [...(this.rooms.get(code)?.messages.values() ?? [])];
    const voice = msgs.filter((m) => {
      const duration = (m.attachment as { voice?: { duration_ms?: unknown } } | null | undefined)?.voice?.duration_ms;
      return typeof duration === 'number' && duration > 0;
    });
    return { messageCount: msgs.filter((m) => m.kind !== 'system').length, voiceCount: voice.length };
  }

  async messageCount(code: string): Promise<number> {
    return (await this.counts(code)).messageCount;
  }

  async attachmentStats(code: string): Promise<RoomAttachmentStats> {
    const stats: RoomAttachmentStats = { attachmentCount: 0, attachmentBytes: 0, voiceCount: 0, voiceBytes: 0 };
    for (const m of this.rooms.get(code)?.messages.values() ?? []) {
      const parsed = chatMessageSchema.pick({ attachment: true, attachments: true }).safeParse(m);
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
    return stats;
  }

  async close(code: string): Promise<RoomDeleteStats | null> {
    const r = this.rooms.get(code);
    if (!r) return null;
    this.log.push(`storage:${code}`);
    const objects = r.objects.size;
    const bytes = [...r.objects.values()].reduce((a, b) => a + b, 0);
    this.log.push(`docs:${code}`);
    const docs = 1 + r.messages.size + r.presence.size;
    this.rooms.delete(code);
    return { objects, bytes, docs };
  }

  private room(code: string): StoredRoom {
    const r = this.rooms.get(code);
    if (!r) throw new Error(`no room ${code}`);
    return r;
  }
}

function toRoom(code: string, d: Raw): AdminRoom | null {
  if (typeof d.created_at !== 'string' || typeof d.expires_at !== 'string') return null;
  return {
    code,
    name: typeof d.name === 'string' ? d.name : null,
    createdAt: new Date(d.created_at),
    expiresAt: new Date(d.expires_at),
    ttlHours: typeof d.ttl_hours === 'number' ? d.ttl_hours : 0,
    createdBy: typeof d.created_by === 'string' ? d.created_by : null,
    creatorTz: typeof d.creator_tz === 'string' ? d.creator_tz : null,
  };
}
