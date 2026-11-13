import 'server-only';

import { unstable_cache } from 'next/cache';
import { getContainer } from '@/server/container';
import { buildRoomDetail, buildRoomRow, mapLimit, ROW_CONCURRENCY, toRoomHistoryRow } from './rows';
import { ROOM_CODE_PATTERN, normaliseRoomCode, type RoomsParams } from './schemas';
import type { RoomDetailDto, RoomHistoryRowDto, RoomRowDto } from './types';

// Rooms screen reads. Metadata only [D-4]. The caller has already passed
// requireAdmin('rooms:read').
//
// Firestore reads per page load (cache miss), 25 rows:
//   list query 25 + per row 3 aggregates (online 1, messages 2) = 100.
//   R2: one ListObjectsV2 per row (no Firestore).
// Detail sheet: 1 get + 4 aggregates (online, messages, system, voice) = 5.
// History tab: 25 (one per row).
// Each is cached 30 s (history 60 s) under the `rooms` tag; closeRoom clears it.

/** Cache tag for every rooms query. closeRoom calls updateTag(ROOMS_TAG). */
export const ROOMS_TAG = 'rooms';
const PAGE_SIZE = 25;
const LIVE_TTL_S = 30;
const HISTORY_TTL_S = 60;

/** `checkedAt`: when the counts were read (ms), so countdowns match the cached data. */
export type RoomsPage = { rows: RoomRowDto[]; nextCursor: string | null; checkedAt: number };
export type RoomHistoryPageDto = { rows: RoomHistoryRowDto[]; nextCursor: string | null };

const cachedLivePage = unstable_cache(
  async (status: 'live' | 'expiring', ttl: string | null, cursor: string | null): Promise<RoomsPage> => {
    const rooms = getContainer().rooms;
    const page = await rooms.list({
      status,
      ttlHours: ttl ? (Number(ttl) as 1 | 24 | 168) : undefined,
      cursor,
      limit: PAGE_SIZE,
    });
    const rows = await mapLimit(page.rooms, ROW_CONCURRENCY, (room) => buildRoomRow(rooms, room));
    return { rows, nextCursor: page.nextCursor, checkedAt: Date.now() };
  },
  ['admin-rooms-live'],
  { tags: [ROOMS_TAG], revalidate: LIVE_TTL_S },
);

const cachedRoomByCode = unstable_cache(
  async (code: string): Promise<RoomRowDto | null> => {
    const rooms = getContainer().rooms;
    const room = await rooms.get(code);
    return room ? buildRoomRow(rooms, room) : null;
  },
  ['admin-rooms-by-code'],
  { tags: [ROOMS_TAG], revalidate: LIVE_TTL_S },
);

const cachedDetail = unstable_cache(
  async (code: string): Promise<RoomDetailDto | null> => {
    const rooms = getContainer().rooms;
    const room = await rooms.get(code);
    return room ? buildRoomDetail(rooms, room) : null;
  },
  ['admin-rooms-detail'],
  { tags: [ROOMS_TAG], revalidate: LIVE_TTL_S },
);

const cachedHistory = unstable_cache(
  async (cursor: string | null): Promise<RoomHistoryPageDto> => {
    const page = await getContainer().rooms.listHistory({ cursor, limit: PAGE_SIZE });
    return { rows: page.rooms.map(toRoomHistoryRow), nextCursor: page.nextCursor };
  },
  ['admin-rooms-history'],
  { tags: [ROOMS_TAG], revalidate: HISTORY_TTL_S },
);

/**
 * Live rooms (`status=live|expiring`). `q` is an exact room code (one `get`);
 * anything else matches nothing (Firestore has no cheap partial search).
 */
export async function listRooms(params: RoomsParams): Promise<RoomsPage> {
  if (params.q) {
    const code = normaliseRoomCode(params.q);
    if (!ROOM_CODE_PATTERN.test(code)) return { rows: [], nextCursor: null, checkedAt: Date.now() };
    const row = await cachedRoomByCode(code);
    return { rows: row ? [row] : [], nextCursor: null, checkedAt: Date.now() };
  }
  const status = params.status === 'expiring' ? 'expiring' : 'live';
  return cachedLivePage(status, params.ttl ?? null, params.cursor ?? null);
}

/** Detail sheet. null when the room no longer exists (expired and swept, or closed). */
export function getRoomDetail(code: string): Promise<RoomDetailDto | null> {
  return cachedDetail(code);
}

/** History tab: closed rooms, newest close first. */
export function listRoomHistory(cursor: string | null): Promise<RoomHistoryPageDto> {
  return cachedHistory(cursor);
}

/**
 * peak_online (step 1.8): raise the stored peak for rooms seen with people
 * online. Call it in `after()`: the page never waits. One transaction per
 * room only when the count beats what this instance last wrote.
 */
export async function notePeakOnline(rows: readonly Pick<RoomRowDto, 'code' | 'onlineCount'>[]): Promise<void> {
  const rooms = getContainer().rooms;
  for (const row of rows) {
    if (row.onlineCount && row.onlineCount > 0) await rooms.observeOnline(row.code, row.onlineCount);
  }
}
