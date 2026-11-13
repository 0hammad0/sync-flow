import { z } from 'zod';

// Shared by the rooms screen (client) and its actions and page (server).
// Spec: docs/admin/03-features/12-rooms.md.

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

export const roomCodeSchema = z
  .string()
  .transform(normaliseRoomCode)
  .refine((v) => ROOM_CODE_PATTERN.test(v), 'Codes are 8 letters and numbers.');

/** URL params of /admin/rooms. Unknown values fall back to the defaults. */
export const roomsParamsSchema = z.object({
  status: z.enum(ROOM_STATUSES).catch('live'),
  ttl: z.enum(ROOM_TTLS).optional().catch(undefined),
  q: z.string().trim().max(40).optional().catch(undefined),
  cursor: z.string().max(400).optional().catch(undefined),
  /** Opens the detail sheet. */
  code: roomCodeSchema.optional().catch(undefined),
});
export type RoomsParams = z.infer<typeof roomsParamsSchema>;

/**
 * Close room input. `confirm` must be the room code typed by the admin
 * (type-to-confirm), checked again on the server.
 */
export const closeRoomSchema = z
  .object({
    code: roomCodeSchema,
    reason: z
      .string()
      .trim()
      .min(REASON_MIN, 'Add a reason (at least 3 characters).')
      .max(REASON_MAX, `Keep the reason under ${REASON_MAX} characters.`),
    confirm: z.string().transform(normaliseRoomCode),
  })
  .refine((v) => v.confirm === v.code, { path: ['confirm'], message: 'Type the room code to confirm.' });
export type CloseRoomInput = z.input<typeof closeRoomSchema>;
