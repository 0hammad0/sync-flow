import 'server-only';

import type { AdminRoom, RoomHistoryEntry } from '@/server/repositories/interfaces';
import type { RoomService } from '@/server/services/room-service';
import type { RoomDetailDto, RoomHistoryRowDto, RoomRowDto } from './types';

// Builds the rooms screen DTOs from the RoomService. Every number comes from
// an aggregate count() or an R2 prefix sum: no message is read [D-4]. A
// number that fails is null ("—" in the UI); the row still shows.

type RoomStats = Pick<RoomService, 'onlineCount' | 'messageCount' | 'counts' | 'storageUsage'>;

/** Rows are built at most this many at a time (each costs 3 Firestore aggregates + 1 R2 list). */
export const ROW_CONCURRENCY = 5;

const settled = <T>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);

/** Runs `fn` over `items`, at most `limit` at once, keeping order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function baseRow(room: AdminRoom): Omit<RoomRowDto, 'onlineCount' | 'messageCount' | 'fileCount' | 'totalBytes'> {
  return {
    code: room.code,
    name: room.name,
    ttlHours: room.ttlHours,
    createdAt: room.createdAt.toISOString(),
    expiresAt: room.expiresAt.toISOString(),
    createdBy: room.createdBy,
  };
}

/** List row: online (1 aggregate) + messages (2 aggregates) + R2 prefix sum. */
export async function buildRoomRow(stats: RoomStats, room: AdminRoom): Promise<RoomRowDto> {
  const [online, messages, storage] = await Promise.allSettled([
    stats.onlineCount(room.code),
    stats.messageCount(room.code),
    stats.storageUsage(room.code),
  ]);
  const usage = settled(storage);
  return {
    ...baseRow(room),
    onlineCount: settled(online),
    messageCount: settled(messages),
    fileCount: usage?.objects ?? null,
    totalBytes: usage?.bytes ?? null,
  };
}

/** Detail: online (1) + messages and voice (3 aggregates) + R2 prefix sum. */
export async function buildRoomDetail(stats: RoomStats, room: AdminRoom): Promise<RoomDetailDto> {
  const [online, counts, storage] = await Promise.allSettled([
    stats.onlineCount(room.code),
    stats.counts(room.code),
    stats.storageUsage(room.code),
  ]);
  const c = settled(counts);
  const usage = settled(storage);
  return {
    ...baseRow(room),
    creatorTz: room.creatorTz,
    onlineCount: settled(online),
    messageCount: c?.messageCount ?? null,
    voiceCount: c?.voiceCount ?? null,
    fileCount: usage?.objects ?? null,
    totalBytes: usage?.bytes ?? null,
  };
}

export function toRoomHistoryRow(entry: RoomHistoryEntry): RoomHistoryRowDto {
  return {
    code: entry.code,
    name: entry.name,
    ttlHours: entry.ttlHours,
    createdAt: entry.createdAt.toISOString(),
    closedAt: entry.closedAt.toISOString(),
    closedBy: entry.closedBy,
    createdBy: entry.createdBy,
    messageCount: entry.messageCount,
    fileCount: entry.attachmentCount,
    totalBytes: entry.attachmentBytes,
    voiceCount: entry.voiceCount,
    peakOnline: entry.peakOnline,
  };
}
