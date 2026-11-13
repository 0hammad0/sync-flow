'use server';

import { headers } from 'next/headers';
import { updateTag } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/server/auth/require-admin';
import { requireRecentAuth } from '@/server/auth/step-up';
import { assertNotBlocked } from '@/server/blocklist/assert-not-blocked';
import { clientIp } from '@/server/blocklist/request';
import { getContainer } from '@/server/container';
import { NotFoundError, toActionFailure, type ActionResult } from '@/server/errors';
import { ROOMS_TAG } from './queries';
import { closeRoomSchema } from './schemas';

// Rooms actions. Order (12-rooms.md "closeRoom steps"): block check (admins
// are visitors too, T-27) → requireAdmin('rooms:close') (T-6) → step-up
// (sign-in within 15 min) → zod → RoomService.closeRoom, which deletes the
// R2 prefix first, then the room docs (the shared deleteRoom helper the cron
// uses), writes history write 2 and the `room.close` audit row.

export type CloseRoomData = {
  code: string;
  /** Counts only [D-4]. */
  messageCount: number | null;
  fileCount: number;
  totalBytes: number;
};

export async function closeRoom(input: unknown): Promise<ActionResult<CloseRoomData>> {
  const blocked = await assertNotBlocked();
  if (blocked) return { ok: false, error: 'blocked', ref: blocked.ref };
  try {
    const ctx = await requireAdmin('rooms:close');
    requireRecentAuth(ctx);
    const parsed = closeRoomSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'invalid', fields: z.flattenError(parsed.error).fieldErrors };
    const h = await headers();
    const result = await getContainer().rooms.closeRoom(ctx, parsed.data.code, {
      reason: parsed.data.reason,
      request: { ip: clientIp(h), userAgent: h.get('user-agent') },
    });
    if (!result.ok) {
      if (result.error instanceof NotFoundError) {
        updateTag(ROOMS_TAG);
        return { ok: false, error: 'not_found', message: 'This room was already closed or expired.' };
      }
      return toActionFailure(result.error);
    }
    updateTag(ROOMS_TAG);
    const { deleted, counts } = result.data;
    return {
      ok: true,
      data: { code: result.data.code, messageCount: counts?.messageCount ?? null, fileCount: deleted.objects, totalBytes: deleted.bytes },
    };
  } catch (e) {
    return toActionFailure(e);
  }
}
