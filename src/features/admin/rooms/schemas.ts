import { z } from 'zod';

// Shared by the rooms screen (client) and its actions and page (server).
// Spec: docs/admin/03-features/12-rooms.md.

import { REASON_MAX, REASON_MIN, ROOM_CODE_PATTERN, ROOM_STATUSES, ROOM_TTLS, normaliseRoomCode } from './constants';

export * from './constants';

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
