import { QuotaExceededError } from '@/server/quota/quota-guard';
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
  /** deleteCreatedBefore throws QuotaExceededError (deletes stopped for the day). */
  deletesStopped = false;

  async recordOpened(room: RoomHistoryOpen): Promise<boolean> {
    if (this.stopped) return false;
    this.docs.set(room.code, { ...this.docs.get(room.code), ...pickOpen(room) });
    return true;
  }

  async recordClosed(room: RoomHistoryClose): Promise<boolean> {
    if (this.stopped) return false;
    const { closedAt, closedBy, messageCount, attachmentCount, attachmentBytes, voiceCount } = room;
    const prev = this.docs.get(room.code);
    const online = room.onlineAtClose ?? 0;
    this.docs.set(room.code, {
      ...prev,
      ...pickOpen(room),
      closedAt,
      closedBy,
      messageCount,
      attachmentCount,
      attachmentBytes,
      voiceCount,
      ...(online > 0 ? { peakOnline: Math.max(prev?.peakOnline ?? 0, online) } : {}),
    });
    return true;
  }

  async notePeakOnline(code: string, online: number): Promise<boolean> {
    const doc = this.docs.get(code);
    if (this.stopped || !doc || !(online > 0) || (doc.peakOnline ?? 0) >= online) return false;
    doc.peakOnline = online;
    return true;
  }

  async deleteCreatedBefore(cutoff: Date, limit: number): Promise<number> {
    if (this.deletesStopped) throw new QuotaExceededError('deletes', 'cap');
    const old = [...this.docs.values()]
      .filter((d) => d.createdAt.getTime() < cutoff.getTime())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, Math.min(Math.max(Math.floor(limit), 1), 500));
    for (const d of old) this.docs.delete(d.code);
    return old.length;
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
