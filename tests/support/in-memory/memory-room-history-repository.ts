import type {
  RoomHistoryClose,
  RoomHistoryEntry,
  RoomHistoryOpen,
  RoomHistoryPage,
  RoomHistoryRepository,
} from '@/server/repositories/interfaces';

type Stored = Partial<RoomHistoryEntry> & RoomHistoryOpen;

/**
 * In-memory `a_rooms`. Writes merge like Firestore `set(…, { merge: true })`.
 * `stopped` makes every write return false (QuotaGuard said 'stop').
 */
export class MemoryRoomHistoryRepository implements RoomHistoryRepository {
  readonly docs = new Map<string, Stored>();
  stopped = false;

  async recordOpened(room: RoomHistoryOpen): Promise<boolean> {
    if (this.stopped) return false;
    this.docs.set(room.code, { ...this.docs.get(room.code), ...pickOpen(room) });
    return true;
  }

  async recordClosed(room: RoomHistoryClose): Promise<boolean> {
    if (this.stopped) return false;
    const { closedAt, closedBy, messageCount, attachmentCount, attachmentBytes, voiceCount } = room;
    this.docs.set(room.code, {
      ...this.docs.get(room.code),
      ...pickOpen(room),
      closedAt,
      closedBy,
      messageCount,
      attachmentCount,
      attachmentBytes,
      voiceCount,
    });
    return true;
  }

  async listClosed(query: { cursor?: string | null; limit: number }): Promise<RoomHistoryPage> {
    const limit = Math.min(Math.max(Math.floor(query.limit), 1), 100);
    const closed = [...this.docs.values()]
      .filter((d): d is Stored & { closedAt: Date; closedBy: string } => d.closedAt instanceof Date)
      .sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime() || b.code.localeCompare(a.code));
    const start = query.cursor ? Number(query.cursor) : 0;
    const rooms: RoomHistoryEntry[] = closed.slice(start, start + limit).map((d) => ({
      ...pickOpen(d),
      closedAt: d.closedAt,
      closedBy: d.closedBy,
      messageCount: d.messageCount ?? null,
      attachmentCount: d.attachmentCount ?? null,
      attachmentBytes: d.attachmentBytes ?? null,
      voiceCount: d.voiceCount ?? null,
      peakOnline: d.peakOnline ?? null,
    }));
    return { rooms, nextCursor: rooms.length === limit ? String(start + limit) : null };
  }
}

function pickOpen(r: RoomHistoryOpen): RoomHistoryOpen {
  return { code: r.code, name: r.name, createdAt: r.createdAt, expiresAt: r.expiresAt, ttlHours: r.ttlHours, createdBy: r.createdBy };
}
