import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminContext } from '@/server/auth/types';
import { QuotaExceededError } from '@/server/quota/quota-guard';
import { AuditService } from '@/server/services/audit-service';
import {
  ROOM_HISTORY_RETENTION_BATCH,
  ROOM_HISTORY_RETENTION_DAYS,
  ROOM_HISTORY_RETENTION_MAX_BATCHES,
  RoomService,
} from '@/server/services/room-service';
import { UserService } from '@/server/services/user-service';
import { MemoryAuditRepository } from '../../../support/memory-audit-repository';
import { MemoryUserRepository } from '../../../support/in-memory/memory-misc-repositories';
import { MemoryRoomHistoryRepository } from '../../../support/in-memory/memory-room-history-repository';
import { MemoryRoomRepository } from '../../../support/in-memory/memory-room-repository';

// Phase 1 steps 1.3 / 1.4 / 1.8: peak_online, history retention, the close
// audit row, and the user guards.

const NOW = new Date('2026-11-13T12:00:00.000Z');
const owner: AdminContext = { uid: 'uidOwnerAAAAAAAAAAAAAAAAAAAA', email: 'owner@example.com', role: 'owner', authTime: 1 };
const CODE = 'ROOMAAA1';
const SECRET = 'TOP-SECRET-TEXT';

function seedRoom(rooms: MemoryRoomRepository, code = CODE) {
  rooms.addRoom(code, {
    name: 'Team',
    created_at: '2026-11-13T00:00:00.000Z',
    expires_at: '2026-11-14T00:00:00.000Z',
    ttl_hours: 24,
    created_by: null,
    creator_tz: 'UTC',
  });
  rooms.addMessage(code, 'a', { kind: 'chat', content: SECRET, attachment: { key: 'k', name: 'secret.pdf', size: 10, mime_type: 'application/pdf' } });
  rooms.addMessage(code, 'b', { kind: 'system', content: 'joined' });
  rooms.addObject(code, `chat/${code}/x`, 1000);
}

describe('RoomService: rooms screen and history', () => {
  let rooms: MemoryRoomRepository;
  let history: MemoryRoomHistoryRepository;
  let auditRepo: MemoryAuditRepository;
  let service: RoomService;
  const logger = { error: vi.fn() };

  beforeEach(() => {
    rooms = new MemoryRoomRepository();
    seedRoom(rooms);
    history = new MemoryRoomHistoryRepository();
    auditRepo = new MemoryAuditRepository();
    logger.error.mockClear();
    service = new RoomService({ reader: rooms, closer: rooms, history, audit: new AuditService(auditRepo), now: () => NOW, logger });
  });

  it('admin close: audit before holds every count and no content; history matches the cron shape', async () => {
    rooms.addPresence(CODE, 'd1', '2026-11-13T11:59:00.000Z');
    rooms.addPresence(CODE, 'd2', '2026-11-13T11:58:30.000Z');
    const result = await service.closeRoom(owner, CODE, { reason: 'abuse' });
    expect(result.ok).toBe(true);
    const [row] = (await auditRepo.list({ limit: 5 })).entries;
    expect(row.before).toMatchObject({
      code: CODE,
      messageCount: 1,
      voiceCount: 0,
      attachmentCount: 1,
      attachmentBytes: 1000,
      onlineCount: 2,
    });
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(JSON.stringify(row)).not.toContain('secret.pdf');

    // Same fields the cron writes, closed_by = the admin uid, peak from the close.
    expect(history.docs.get(CODE)).toMatchObject({
      closedBy: owner.uid,
      messageCount: 1,
      attachmentCount: 1,
      attachmentBytes: 1000,
      voiceCount: 0,
      peakOnline: 2,
    });
  });

  it('cron close folds the online-at-close count into peak_online without lowering a higher one', async () => {
    const chatRoom = {
      code: CODE,
      name: 'Team',
      created_at: '2026-11-13T00:00:00.000Z',
      expires_at: '2026-11-13T01:00:00.000Z',
      ttl_hours: 1 as const,
      created_by: null,
      creator_tz: null,
    };
    await service.recordOpened(chatRoom);
    expect(await service.observeOnline(CODE, 4)).toBe(true);
    rooms.addPresence(CODE, 'd1', '2026-11-13T11:59:00.000Z');
    const hooks = service.cronHooks();
    const snapshot = await hooks.beforeDelete?.(chatRoom);
    expect(snapshot).toEqual({ counts: { messageCount: 1, voiceCount: 0 }, online: 1 });
    await hooks.afterDelete?.(chatRoom, { objects: 1, bytes: 1000, docs: null }, snapshot);
    expect(history.docs.get(CODE)).toMatchObject({ closedBy: 'cron', peakOnline: 4 });
  });

  it('observeOnline: writes only when this instance sees a higher count; a failure is retried next time', async () => {
    await history.recordOpened({ code: CODE, name: null, createdAt: NOW, expiresAt: NOW, ttlHours: 1, createdBy: null });
    const note = vi.spyOn(history, 'notePeakOnline');
    expect(await service.observeOnline(CODE, 0)).toBe(false);
    expect(await service.observeOnline(CODE, 2)).toBe(true);
    expect(await service.observeOnline(CODE, 2)).toBe(false);
    expect(await service.observeOnline(CODE, 1)).toBe(false);
    expect(note).toHaveBeenCalledTimes(1);

    note.mockRejectedValueOnce(new Error('firestore down'));
    expect(await service.observeOnline(CODE, 3)).toBe(false);
    expect(logger.error).toHaveBeenCalled();
    expect(await service.observeOnline(CODE, 3)).toBe(true);
    expect(history.docs.get(CODE)?.peakOnline).toBe(3);
  });

  describe('sweepHistory (a_rooms retention)', () => {
    const addHistory = (n: number, daysAgo: number) => {
      for (let i = 0; i < n; i++) {
        const createdAt = new Date(NOW.getTime() - daysAgo * 86_400_000 - i * 1000);
        history.docs.set(`H${daysAgo}_${i}`, { code: `H${daysAgo}_${i}`, name: null, createdAt, expiresAt: createdAt, ttlHours: 1, createdBy: null });
      }
    };

    it('deletes only docs older than the retention period, in batches of 500', async () => {
      expect(ROOM_HISTORY_RETENTION_DAYS).toBe(365);
      addHistory(700, 400);
      addHistory(3, 364);
      const result = await service.sweepHistory();
      expect(result).toEqual({ removed: 700, batches: 2, capped: false, quotaStopped: false });
      expect(history.docs.size).toBe(3);
    });

    it('stops at the per-run batch cap and reports that more is left', async () => {
      addHistory(ROOM_HISTORY_RETENTION_BATCH * ROOM_HISTORY_RETENTION_MAX_BATCHES + 10, 400);
      const result = await service.sweepHistory();
      expect(result).toEqual({
        removed: ROOM_HISTORY_RETENTION_BATCH * ROOM_HISTORY_RETENTION_MAX_BATCHES,
        batches: ROOM_HISTORY_RETENTION_MAX_BATCHES,
        capped: true,
        quotaStopped: false,
      });
    });

    it('stops when the time budget runs out', async () => {
      addHistory(1200, 400);
      let calls = 0;
      const result = await service.sweepHistory(() => calls++ < 1);
      expect(result).toEqual({ removed: 500, batches: 1, capped: true, quotaStopped: false });
    });

    it('stops quietly at the daily delete budget', async () => {
      addHistory(10, 400);
      history.deletesStopped = true;
      expect(await service.sweepHistory()).toEqual({ removed: 0, batches: 0, capped: true, quotaStopped: true });
      expect(history.docs.size).toBe(10);
    });

    it('never throws on a store failure', async () => {
      history.deleteCreatedBefore = async () => {
        throw new Error('firestore down');
      };
      expect(await service.sweepHistory()).toEqual({ error: 'history_retention_failed', removed: 0 });
      history.deleteCreatedBefore = async () => {
        throw new QuotaExceededError('deletes', 'exhausted');
      };
      expect(await service.sweepHistory()).toMatchObject({ quotaStopped: true });
    });
  });

  it('storageUsage sums the room prefix only', async () => {
    const prefixUsage = vi.fn(async () => ({ objects: 3, bytes: 99 }));
    const withStorage = new RoomService({ reader: rooms, closer: rooms, history, audit: new AuditService(auditRepo), storage: { prefixUsage } });
    expect(await withStorage.storageUsage(CODE)).toEqual({ objects: 3, bytes: 99 });
    expect(prefixUsage).toHaveBeenCalledWith(`chat/${CODE}/`);
    await expect(service.storageUsage(CODE)).rejects.toThrow('no storage');
  });
});

describe('UserService: screen guards', () => {
  let users: MemoryUserRepository;
  let auditRepo: MemoryAuditRepository;
  let service: UserService;
  const other = 'uidOtherOwnerCCCCCCCCCCCCCCC';
  const target = 'uidTargetBBBBBBBBBBBBBBBBBBB';

  beforeEach(() => {
    users = new MemoryUserRepository();
    users.addUser({ uid: owner.uid, email: owner.email, role: 'owner' });
    users.addUser({ uid: other, email: 'other@example.com', role: 'owner' });
    users.addUser({ uid: target, email: 'sara@example.com' });
    auditRepo = new MemoryAuditRepository();
    service = new UserService({ reader: users, admin: users, audit: new AuditService(auditRepo), now: () => NOW });
  });

  it('an owner cannot remove their own owner role or disable themselves', async () => {
    for (const role of [null, 'moderator', 'viewer'] as const) {
      const result = await service.setUserRole(owner, owner.uid, role);
      expect(result.ok).toBe(false);
    }
    expect((await service.disableUser(owner, owner.uid)).ok).toBe(false);
    expect((await users.get(owner.uid))?.role).toBe('owner');
    expect((await users.get(owner.uid))?.disabled).toBe(false);
    expect(await auditRepo.list({ limit: 5 })).toMatchObject({ entries: [] });
  });

  it('disable revokes sessions; role.set records before and after; every row names the target by email', async () => {
    expect((await service.disableUser(owner, target, { reason: 'spam' })).ok).toBe(true);
    expect(users.calls).toEqual([`disabled:${target}:true`, `revoke:${target}`]);
    expect((await service.revokeUserSessions(owner, target)).ok).toBe(true);
    expect((await service.setUserRole(owner, target, 'viewer')).ok).toBe(true);
    const rows = (await auditRepo.list({ limit: 10 })).entries;
    expect(rows.map((r) => r.action).sort()).toEqual(['role.set', 'user.disable', 'user.revoke_sessions']);
    expect(rows.find((r) => r.action === 'role.set')).toMatchObject({
      before: { email: 'sara@example.com', role: null },
      after: { role: 'viewer' },
    });
    expect(rows.find((r) => r.action === 'user.disable')).toMatchObject({ reason: 'spam', after: { disabled: true } });
  });

  it('another owner may be demoted (the actor stays an owner, so there is always one)', async () => {
    expect((await service.setUserRole(owner, other, 'moderator')).ok).toBe(true);
    expect((await users.get(owner.uid))?.role).toBe('owner');
  });
});
