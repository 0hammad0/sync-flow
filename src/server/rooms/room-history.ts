import 'server-only';

import { getContainer } from '@/server/container';
import type { RoomCounts } from '@/server/repositories/interfaces';
import type { ExpiredRoomHooks } from '@/shared/lib/firebase/chat';
import type { ChatRoom } from '@/types';

// Entry points for room history (`a_rooms`, phase 1 step 1.8) from public
// code: room creation and the cleanup cron. Both never throw, so chat and
// the cron never fail or wait on admin work (hard rule 8).

/** History write 1. Call it inside `after()` so the visitor never waits. */
export async function recordRoomOpened(room: ChatRoom): Promise<void> {
  try {
    await getContainer().rooms.recordOpened(room);
  } catch (error) {
    console.error(`[rooms] could not record room ${room.code} as opened`, error);
  }
}

/** Hooks for deleteExpiredRooms (history write 2). Empty hooks when the container cannot start. */
export function cronRoomHooks(): ExpiredRoomHooks<RoomCounts | null> {
  try {
    return getContainer().rooms.cronHooks();
  } catch (error) {
    console.error('[rooms] room history is off for this cleanup run', error);
    return {};
  }
}
