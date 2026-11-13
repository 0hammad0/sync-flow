import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminContext } from '@/server/auth/types';
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/errors';
import { AuditService } from '@/server/services/audit-service';
import { FileService } from '@/server/services/file-service';
import { RoomService } from '@/server/services/room-service';
import { UserService } from '@/server/services/user-service';
import { MemoryAuditRepository } from '../../../support/memory-audit-repository';
import { MemoryFileRepository } from '../../../support/in-memory/memory-file-repository';
import { MemoryStorage, MemoryUserRepository } from '../../../support/in-memory/memory-misc-repositories';
import { MemoryRoomHistoryRepository } from '../../../support/in-memory/memory-room-history-repository';
import { MemoryRoomRepository } from '../../../support/in-memory/memory-room-repository';
import { FILE_SEED, ROOM_A, SECRET } from '../repositories/file-repository.contract';

const NOW = new Date('2026-11-13T12:00:00.000Z');
const owner: AdminContext = { uid: 'uidOwnerAAAAAAAAAAAAAAAAAAAA', email: 'owner@example.com', role: 'owner', authTime: 1 };
const quiet = { error: vi.fn() };

async function auditRows(repo: MemoryAuditRepository) {
  return (await repo.list({ limit: 100 })).entries;
}

describe('FileService', () => {
  let files: MemoryFileRepository;
  let storage: MemoryStorage;
  let auditRepo: MemoryAuditRepository;
  let service: FileService;

  beforeEach(() => {
    files = new MemoryFileRepository();
    for (const s of FILE_SEED.shares) files.addShare(s.token, s.doc);
    for (const m of FILE_SEED.messages) files.addMessage(m.code, m.id, m.doc);
    storage = new MemoryStorage();
    auditRepo = new MemoryAuditRepository();
    service = new FileService({ reader: files, remover: files, storage, audit: new AuditService(auditRepo), now: () => NOW, logger: quiet });
  });

  it('deletes the R2 object first, then the record, then writes file.delete with metadata only', async () => {
    const result = await service.deleteFile(owner, 's_tok1', { reason: 'spam' });
    expect(result.ok).toBe(true);
    expect(storage.deleted).toEqual(['tok/1.pdf']);
    expect(files.shares.has('tok1')).toBe(false);
    const [row] = await auditRows(auditRepo);
    expect(row).toMatchObject({
      action: 'file.delete',
      targetType: 'share_file',
      targetId: 's_tok1',
      reason: 'spam',
      before: { kind: 'share', name: 'file-1.pdf', size: 100, mime: 'application/pdf', owner: 'u1', room: null },
    });
    expect(JSON.stringify(row)).not.toContain('tok/1.pdf');
  });

  it('changes nothing when R2 refuses the delete', async () => {
    storage.failKeys.add('tok/1.pdf');
    await expect(service.deleteFile(owner, 's_tok1')).rejects.toThrow('R2 refused');
    expect(files.shares.has('tok1')).toBe(true);
    expect(await auditRows(auditRepo)).toEqual([]);
  });

  it('returns NotFound for unknown, malformed and long-text ids, with no R2 call', async () => {
    for (const id of ['s_missing', 'garbage', `c_${ROOM_A}_m3_0`]) {
      const result = await service.deleteFile(owner, id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBeInstanceOf(NotFoundError);
    }
    expect(storage.deleted).toEqual([]);
  });

  it('removes a chat attachment without touching the message text', async () => {
    const result = await service.deleteFile(owner, `c_${ROOM_A}_m1_0`);
    expect(result.ok).toBe(true);
    expect(storage.deleted).toEqual(['chat/AAAAAAAA/a']);
    const m1 = files.messages.find((m) => m.id === 'm1');
    expect(m1?.doc.content).toBe(SECRET);
    expect(JSON.stringify(await auditRows(auditRepo))).not.toContain(SECRET);
  });

  it('bulk delete: one audit row per file with a shared batchId, partial results, cap 100', async () => {
    storage.failKeys.add('tok/5.pdf');
    const result = await service.deleteFiles(owner, ['s_tok1', 's_tok3', 's_missing', 's_tok1']);
    expect(result.ok && result.data).toEqual({ deleted: ['s_tok1'], missing: ['s_missing'], failed: ['s_tok3'] });
    const rows = await auditRows(auditRepo);
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toEqual({ batchId: expect.any(String) });

    const tooMany = await service.deleteFiles(owner, Array.from({ length: 101 }, (_, i) => `s_${i}`));
    expect(!tooMany.ok && tooMany.error).toBeInstanceOf(ValidationError);
  });
});

describe('RoomService', () => {
  let rooms: MemoryRoomRepository;
  let history: MemoryRoomHistoryRepository;
  let auditRepo: MemoryAuditRepository;
  let service: RoomService;
  const code = 'ROOMAAA1';

  beforeEach(() => {
    rooms = new MemoryRoomRepository();
    rooms.addRoom(code, {
      name: 'Team',
      created_at: '2026-11-13T00:00:00.000Z',
      expires_at: '2026-11-14T00:00:00.000Z',
      ttl_hours: 24,
      created_by: null,
      creator_tz: 'UTC',
    });
    rooms.addMessage(code, 'a', { kind: 'chat', content: SECRET });
    rooms.addMessage(code, 'b', { kind: 'system', content: 'joined' });
    rooms.addObject(code, 'chat/ROOMAAA1/x', 1000);
    history = new MemoryRoomHistoryRepository();
    auditRepo = new MemoryAuditRepository();
    service = new RoomService({ reader: rooms, closer: rooms, history, audit: new AuditService(auditRepo), now: () => NOW, logger: quiet });
  });

  it('closeRoom: storage, then docs, then history write 2, then room.close', async () => {
    const result = await service.closeRoom(owner, code, { reason: 'abuse' });
    expect(result.ok).toBe(true);
    expect(rooms.log).toEqual([`storage:${code}`, `docs:${code}`]);
    expect(history.docs.get(code)).toMatchObject({
      closedBy: owner.uid,
      messageCount: 1,
      attachmentCount: 1,
      attachmentBytes: 1000,
      voiceCount: 0,
    });
    const [row] = await auditRows(auditRepo);
    expect(row).toMatchObject({ action: 'room.close', targetId: code, reason: 'abuse' });
    expect(row.before).toMatchObject({ code, name: 'Team', messageCount: 1, attachmentBytes: 1000 });
    expect(JSON.stringify(row)).not.toContain(SECRET);
  });

  it('closeRoom on a gone room is NotFound and writes nothing', async () => {
    const result = await service.closeRoom(owner, 'ZZZZZZZZ');
    expect(!result.ok && result.error).toBeInstanceOf(NotFoundError);
    expect(await auditRows(auditRepo)).toEqual([]);
  });

  it('closeRoom still closes when the history write fails', async () => {
    history.recordClosed = async () => {
      throw new Error('firestore down');
    };
    expect((await service.closeRoom(owner, code)).ok).toBe(true);
    expect(await auditRows(auditRepo)).toHaveLength(1);
  });

  it('recordOpened never throws and reports a quota skip as false', async () => {
    const room = { code: 'NEWROOM1', name: null, created_at: NOW.toISOString(), expires_at: NOW.toISOString(), ttl_hours: 1 as const, created_by: null, creator_tz: null };
    expect(await service.recordOpened(room)).toBe(true);
    history.stopped = true;
    expect(await service.recordOpened({ ...room, code: 'NEWROOM2' })).toBe(false);
    history.recordOpened = async () => {
      throw new Error('boom');
    };
    expect(await service.recordOpened(room)).toBe(false);
  });

  it('cron hooks count before the delete and write history after it; failures are swallowed', async () => {
    const hooks = service.cronHooks();
    const chatRoom = { code, name: 'Team', created_at: '2026-11-13T00:00:00.000Z', expires_at: '2026-11-13T01:00:00.000Z', ttl_hours: 1 as const, created_by: null, creator_tz: null };
    const snapshot = await hooks.beforeDelete?.(chatRoom);
    expect(snapshot).toEqual({ counts: { messageCount: 1, voiceCount: 0 }, online: 0 });
    await hooks.afterDelete?.(chatRoom, { objects: 2, bytes: 50, docs: null }, snapshot);
    expect(history.docs.get(code)).toMatchObject({ closedBy: 'cron', messageCount: 1, attachmentCount: 2, attachmentBytes: 50 });

    rooms.counts = async () => {
      throw new Error('read cap');
    };
    await expect(hooks.beforeDelete?.(chatRoom)).resolves.toEqual({ counts: null, online: 0 });
  });
});

describe('UserService', () => {
  let users: MemoryUserRepository;
  let auditRepo: MemoryAuditRepository;
  let service: UserService;
  const target = 'uidTargetBBBBBBBBBBBBBBBBBBB';

  beforeEach(() => {
    users = new MemoryUserRepository();
    users.addUser({ uid: owner.uid, email: owner.email, role: 'owner' });
    users.addUser({ uid: target, email: 'sara@example.com' });
    auditRepo = new MemoryAuditRepository();
    service = new UserService({ reader: users, admin: users, audit: new AuditService(auditRepo), now: () => NOW });
  });

  it('rejects every action on your own account (owner cannot demote or disable themselves)', async () => {
    for (const result of [
      await service.disableUser(owner, owner.uid),
      await service.revokeUserSessions(owner, owner.uid),
      await service.setUserRole(owner, owner.uid, null),
      await service.enableUser(owner, owner.uid),
    ]) {
      expect(!result.ok && result.error).toBeInstanceOf(ForbiddenError);
    }
    expect(users.calls).toEqual([]);
    expect(await auditRows(auditRepo)).toEqual([]);
  });

  it('disable also revokes sessions and writes user.disable', async () => {
    expect((await service.disableUser(owner, target)).ok).toBe(true);
    expect(users.calls).toEqual([`disabled:${target}:true`, `revoke:${target}`]);
    expect((await auditRows(auditRepo))[0]).toMatchObject({ action: 'user.disable', targetId: target });
  });

  it('setUserRole sets the claim, revokes, updates the roles index and writes role.set', async () => {
    const result = await service.setUserRole(owner, target, 'moderator');
    expect(result.ok && result.data.role).toBe('moderator');
    expect(users.calls).toEqual([`role:${target}:moderator`, `revoke:${target}`]);
    expect(users.roles.get(target)).toMatchObject({ role: 'moderator', grantedBy: owner.uid });
    expect((await auditRows(auditRepo))[0]).toMatchObject({ action: 'role.set', before: { role: null }, after: { role: 'moderator' } });
  });

  it('unknown user is NotFound; find matches exact email or uid only', async () => {
    const result = await service.revokeUserSessions(owner, 'uidNobodyCCCCCCCCCCCCCCCCCCC');
    expect(!result.ok && result.error).toBeInstanceOf(NotFoundError);
    expect((await service.find(' Sara@Example.com '))?.uid).toBe(target);
    expect((await service.find(target))?.uid).toBe(target);
    expect(await service.find('sar')).toBeNull();
  });
});
