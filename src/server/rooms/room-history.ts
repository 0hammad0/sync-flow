import 'server-only';

import { getContainer } from '@/server/container';
import type { HistorySweepResult, RoomCloseSnapshot } from '@/server/services/room-service';
import type { ExpiredRoomHooks } from '@/shared/lib/firebase/chat';
import type { ChatRoom } from '@/types';

// Entry points for room history (`a_rooms`, phase 1 step 1.8) from public
// code: room creation and the cleanup cron. All never throw, so chat and
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
export function cronRoomHooks(): ExpiredRoomHooks<RoomCloseSnapshot> {
  try {
    return getContainer().rooms.cronHooks();
  } catch (error) {
    console.error('[rooms] room history is off for this cleanup run', error);
    return {};
  }
}

/**
 * `a_rooms` retention (365 days [U]) for the cleanup cron: batches of 500,
 * capped per run and by the daily delete budget. Never throws.
 */
export async function sweepRoomHistory(hasTime: () => boolean): Promise<HistorySweepResult> {
  try {
    return await getContainer().rooms.sweepHistory(hasTime);
  } catch (error) {
    console.error('[rooms] room history retention is off for this cleanup run', error);
    return { error: 'history_retention_unavailable', removed: 0 };
  }
}
