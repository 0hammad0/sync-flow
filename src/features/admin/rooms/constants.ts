// Rooms screen constants, zod-free so client components can import them
// without pulling zod into the page's first-load JS. schemas.ts builds on these.

/** Room codes: 8 chars from this alphabet (src/shared/lib/utils.ts generateRoomCode). */
export const ROOM_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

export const ROOM_STATUSES = ['live', 'expiring', 'history'] as const;
export type RoomStatusParam = (typeof ROOM_STATUSES)[number];

export const ROOM_TTLS = ['1', '24', '168'] as const;

export const REASON_MIN = 3;
export const REASON_MAX = 200;

/** Uppercases and trims; anything that is not a code shape stays as typed (and finds nothing). */
export function normaliseRoomCode(raw: string): string {
  return raw.trim().toUpperCase();
}
