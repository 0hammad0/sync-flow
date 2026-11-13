import 'server-only';

import type { AdminContext } from '@/server/auth/types';
import { NotFoundError, err, ok, type Result } from '@/server/errors';
import { QuotaExceededError } from '@/server/quota/quota-guard';
import type {
  AdminRoom,
  RoomAttachmentStats,
  RoomCloser,
  RoomCounts,
  RoomDeleteStats,
  RoomHistoryOpen,
  RoomHistoryPage,
  RoomHistoryRepository,
  RoomListQuery,
  RoomPage,
  RoomReader,
  StorageStats,
} from '@/server/repositories/interfaces';
import type { AuditRequestInfo, AuditService } from '@/server/services/audit-service';
import { roomStoragePrefix, type ExpiredRoomHooks } from '@/shared/lib/firebase/chat';
import type { ChatRoom } from '@/types';

/** Presence older than this is not "online" (chat.ts PRESENCE_STALE_MS). */
export const ONLINE_WINDOW_MS = 3 * 60_000;

/**
 * `a_rooms` retention. 365 days is the docs' proposal (03-data-model.md
 * "Retention", phase 1 step 1.8), still [U: owner to confirm].
 */
export const ROOM_HISTORY_RETENTION_DAYS = 365;
/** One Firestore batch. */
export const ROOM_HISTORY_RETENTION_BATCH = 500;
/** Per cleanup run, so the shared daily delete cap (5,000) keeps room for the rest. */
export const ROOM_HISTORY_RETENTION_MAX_BATCHES = 4;
/** Codes remembered per instance for peak_online, so a page reload costs no new transaction. */
const PEAK_MEMO_MAX = 500;

export type RoomServiceDeps = {
  reader: RoomReader;
  closer: RoomCloser;
  history: RoomHistoryRepository;
  audit: Pick<AuditService, 'record'>;
  /** R2 sums per room prefix (no Firestore). Optional so wiring without R2 still works. */
  storage?: Pick<StorageStats, 'prefixUsage'>;
  now?: () => Date;
  logger?: Pick<Console, 'error'>;
};

export type CloseRoomResult = { code: string; deleted: RoomDeleteStats; counts: RoomCounts | null };

/** What is measured just before a room is deleted. Each part is null when it was skipped or failed. */
export type RoomCloseSnapshot = { counts: RoomCounts | null; online: number | null };

export type HistorySweepResult =
  | { removed: number; batches: number; capped: boolean; quotaStopped: boolean }
  | { error: string; removed: number };

/** A chat room doc (ISO strings) as a history entry. */
export function historyFromChatRoom(room: ChatRoom): RoomHistoryOpen {
  return {
    code: room.code,
    name: room.name,
    createdAt: new Date(room.created_at),
    expiresAt: new Date(room.expires_at),
    ttlHours: room.ttl_hours,
    createdBy: room.created_by,
  };
}

function historyFromRoom(room: AdminRoom): RoomHistoryOpen {
  return {
    code: room.code,
    name: room.name,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    ttlHours: room.ttlHours,
    createdBy: room.createdBy,
  };
}

/**
 * Rooms as metadata only [D-4] (docs/admin/03-features/12-rooms.md) and
 * room history `a_rooms` (phase 1 step 1.8). Permission checks
 * (`rooms:read`, `rooms:close` + step-up) happen in the actions.
 */
export class RoomService {
  private readonly now: () => Date;
  private readonly logger: Pick<Console, 'error'>;
  /** Last peak written per room on this instance (observeOnline). */
  private readonly peakMemo = new Map<string, number>();

  constructor(private readonly deps: RoomServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.logger = deps.logger ?? console;
  }

  list(query: RoomListQuery): Promise<RoomPage> {
    return this.deps.reader.list(query, this.now());
  }

  get(code: string): Promise<AdminRoom | null> {
    return this.deps.reader.get(code);
  }

  onlineCount(code: string): Promise<number> {
    return this.deps.reader.onlineCount(code, new Date(this.now().getTime() - ONLINE_WINDOW_MS));
  }

  counts(code: string): Promise<RoomCounts> {
    return this.deps.reader.counts(code);
  }

  messageCount(code: string): Promise<number> {
    return this.deps.reader.messageCount(code);
  }

  attachmentStats(code: string): Promise<RoomAttachmentStats> {
    return this.deps.reader.attachmentStats(code);
  }

  /** Objects and bytes under `chat/{code}/` in R2 (attachments, voice notes, long-text bodies). */
  async storageUsage(code: string): Promise<{ objects: number; bytes: number }> {
    if (!this.deps.storage) throw new Error('RoomService: no storage stats wired');
    return this.deps.storage.prefixUsage(roomStoragePrefix(code));
  }

  listHistory(query: { cursor?: string | null; limit: number }): Promise<RoomHistoryPage> {
    return this.deps.history.listClosed(query);
  }

  /**
   * peak_online from admin reads (phase 1 step 1.8): when the rooms screen
   * sees more people online than this instance last recorded, raise the
   * stored peak. No chat write ever. Never throws.
   */
  async observeOnline(code: string, online: number): Promise<boolean> {
    if (!(online > 0) || (this.peakMemo.get(code) ?? 0) >= online) return false;
    if (this.peakMemo.size >= PEAK_MEMO_MAX) this.peakMemo.clear();
    this.peakMemo.set(code, online);
    try {
      return await this.deps.history.notePeakOnline(code, online);
    } catch (error) {
      this.peakMemo.delete(code);
      this.logger.error(`[rooms] peak_online write failed for ${code}`, error);
      return false;
    }
  }

  /**
   * `a_rooms` retention for the cleanup cron: delete history docs created
   * more than ROOM_HISTORY_RETENTION_DAYS ago, in batches of 500, at most
   * ROOM_HISTORY_RETENTION_MAX_BATCHES per run, while `hasTime()` and the
   * daily delete budget allow. Never throws.
   */
  async sweepHistory(hasTime: () => boolean = () => true): Promise<HistorySweepResult> {
    const cutoff = new Date(this.now().getTime() - ROOM_HISTORY_RETENTION_DAYS * 86_400_000);
    let removed = 0;
    let batches = 0;
    try {
      while (batches < ROOM_HISTORY_RETENTION_MAX_BATCHES && hasTime()) {
        const n = await this.deps.history.deleteCreatedBefore(cutoff, ROOM_HISTORY_RETENTION_BATCH);
        batches++;
        removed += n;
        if (n < ROOM_HISTORY_RETENTION_BATCH) return { removed, batches, capped: false, quotaStopped: false };
      }
      // Stopped by the batch cap or the time budget: more may be left for the next run.
      return { removed, batches, capped: true, quotaStopped: false };
    } catch (error) {
      if (error instanceof QuotaExceededError) return { removed, batches, capped: true, quotaStopped: true };
      this.logger.error('[rooms] history retention failed', error);
      return { error: 'history_retention_failed', removed };
    }
  }

  /**
   * Admin "Close room": counts (aggregates) → R2 prefix → room docs →
   * history write 2 → `room.close` audit row. A failed history write is
   * logged, never fails the close.
   */
  async closeRoom(
    ctx: AdminContext,
    code: string,
    opts: { reason?: string | null; request?: AuditRequestInfo } = {},
  ): Promise<Result<CloseRoomResult>> {
    const room = await this.deps.reader.get(code);
    if (!room) return err(new NotFoundError('room'));
    const snapshot = await this.snapshot(code);
    const { counts } = snapshot;

    // The shared deleteRoom helper (R2 prefix first, then the docs), the one the cron uses.
    const deleted = await this.deps.closer.close(code);
    if (!deleted) return err(new NotFoundError('room'));

    // History write 2, exactly as the cron writes it, with the admin's uid as closed_by.
    await this.recordClosed(historyFromRoom(room), ctx.uid, snapshot, deleted);
    await this.deps.audit.record({
      ctx,
      action: 'room.close',
      target: { type: 'room', id: code },
      // Counts and sizes only [D-4]: no text, no file names.
      before: {
        code,
        name: room.name,
        ttl_hours: room.ttlHours,
        created_at: room.createdAt,
        expires_at: room.expiresAt,
        created_by: room.createdBy,
        messageCount: counts?.messageCount ?? null,
        voiceCount: counts?.voiceCount ?? null,
        attachmentCount: deleted.objects,
        attachmentBytes: deleted.bytes,
        onlineCount: snapshot.online,
      },
      after: { objectsDeleted: deleted.objects, docsDeleted: deleted.docs },
      reason: opts.reason ?? null,
      request: opts.request,
    });
    return ok({ code, deleted, counts });
  }

  /** History write 1. Never throws; false when skipped or failed. */
  async recordOpened(room: ChatRoom): Promise<boolean> {
    try {
      return await this.deps.history.recordOpened(historyFromChatRoom(room));
    } catch (error) {
      this.logger.error(`[rooms] history write failed for ${room.code}`, error);
      return false;
    }
  }

  /**
   * Hooks for the cleanup cron's deleteExpiredRooms: count before the delete
   * (skipped at the read cap), write history after it (skipped at the write
   * cap). Both never throw, so the cron never fails because of them.
   */
  cronHooks(): ExpiredRoomHooks<RoomCloseSnapshot> {
    return {
      beforeDelete: (room) => this.snapshot(room.code),
      afterDelete: async (room, deleted, snapshot) => {
        await this.recordClosed(historyFromChatRoom(room), 'cron', snapshot ?? { counts: null, online: null }, deleted);
      },
    };
  }

  /** Final counts (3 aggregates) and people online (1 aggregate). A failed part is null, never thrown. */
  private async snapshot(code: string): Promise<RoomCloseSnapshot> {
    const [counts, online] = await Promise.all([
      this.deps.reader.counts(code).catch((error: unknown) => {
        this.logger.error(`[rooms] final counts skipped for ${code}`, error);
        return null;
      }),
      this.onlineCount(code).catch((error: unknown) => {
        this.logger.error(`[rooms] online count skipped for ${code}`, error);
        return null;
      }),
    ]);
    return { counts, online };
  }

  private async recordClosed(
    room: RoomHistoryOpen,
    closedBy: string,
    snapshot: RoomCloseSnapshot,
    deleted: RoomDeleteStats,
  ): Promise<void> {
    const { counts, online } = snapshot;
    try {
      await this.deps.history.recordClosed({
        ...room,
        closedAt: this.now(),
        closedBy,
        messageCount: counts?.messageCount ?? null,
        // R2 objects under chat/{code}/ (includes long-text bodies).
        attachmentCount: deleted.objects,
        attachmentBytes: deleted.bytes,
        voiceCount: counts?.voiceCount ?? null,
        // peak_online: folded into this same write, never lowered.
        onlineAtClose: online,
      });
    } catch (error) {
      this.logger.error(`[rooms] history close write failed for ${room.code}`, error);
    }
  }
}
