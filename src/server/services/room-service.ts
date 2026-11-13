import 'server-only';

import type { AdminContext } from '@/server/auth/types';
import { NotFoundError, err, ok, type Result } from '@/server/errors';
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
} from '@/server/repositories/interfaces';
import type { AuditRequestInfo, AuditService } from '@/server/services/audit-service';
import type { ExpiredRoomHooks } from '@/shared/lib/firebase/chat';
import type { ChatRoom } from '@/types';

/** Presence older than this is not "online" (chat.ts PRESENCE_STALE_MS). */
export const ONLINE_WINDOW_MS = 3 * 60_000;

export type RoomServiceDeps = {
  reader: RoomReader;
  closer: RoomCloser;
  history: RoomHistoryRepository;
  audit: Pick<AuditService, 'record'>;
  now?: () => Date;
  logger?: Pick<Console, 'error'>;
};

export type CloseRoomResult = { code: string; deleted: RoomDeleteStats; counts: RoomCounts | null };

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

  attachmentStats(code: string): Promise<RoomAttachmentStats> {
    return this.deps.reader.attachmentStats(code);
  }

  listHistory(query: { cursor?: string | null; limit: number }): Promise<RoomHistoryPage> {
    return this.deps.history.listClosed(query);
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
    const counts = await this.deps.reader.counts(code).catch((error: unknown) => {
      this.logger.error(`[rooms] counts failed for ${code}; closing without them`, error);
      return null;
    });

    const deleted = await this.deps.closer.close(code);
    if (!deleted) return err(new NotFoundError('room'));

    await this.recordClosed(historyFromRoom(room), ctx.uid, counts, deleted);
    await this.deps.audit.record({
      ctx,
      action: 'room.close',
      target: { type: 'room', id: code },
      before: {
        code,
        name: room.name,
        ttl_hours: room.ttlHours,
        created_at: room.createdAt,
        expires_at: room.expiresAt,
        created_by: room.createdBy,
        messageCount: counts?.messageCount ?? null,
        attachmentBytes: deleted.bytes,
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
  cronHooks(): ExpiredRoomHooks<RoomCounts | null> {
    return {
      beforeDelete: (room) =>
        this.deps.reader.counts(room.code).catch((error: unknown) => {
          this.logger.error(`[rooms] final counts skipped for ${room.code}`, error);
          return null;
        }),
      afterDelete: async (room, deleted, counts) => {
        await this.recordClosed(historyFromChatRoom(room), 'cron', counts ?? null, deleted);
      },
    };
  }

  private async recordClosed(
    room: RoomHistoryOpen,
    closedBy: string,
    counts: RoomCounts | null,
    deleted: RoomDeleteStats,
  ): Promise<void> {
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
      });
    } catch (error) {
      this.logger.error(`[rooms] history close write failed for ${room.code}`, error);
    }
  }
}
