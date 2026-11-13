import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildRoomDetail, buildRoomRow, mapLimit, toRoomHistoryRow } from '@/features/admin/rooms/rows';
import { ROOM_DETAIL_KEYS, ROOM_HISTORY_KEYS } from '@/features/admin/rooms/types';
import { AuditService } from '@/server/services/audit-service';
import { RoomService } from '@/server/services/room-service';
import { MemoryAuditRepository } from '../../../../support/memory-audit-repository';
import { MemoryRoomHistoryRepository } from '../../../../support/in-memory/memory-room-history-repository';
import { MemoryRoomRepository } from '../../../../support/in-memory/memory-room-repository';

// The counts-only guarantee [D-4, D-6]: whatever a room holds, the rooms
// screen DTOs carry counts, sizes and times only. No message text, no file
// names, no R2 keys, no reply snippets, no sender names.

const NOW = new Date('2026-11-13T12:00:00.000Z');
const CODE = 'AB7KQ2MZ';
const SECRETS = ['TOP-SECRET-TEXT', 'secret-file-name.pdf', 'chat/AB7KQ2MZ/key-1', 'Sender Sara', 'reply snippet text'];

function seed(rooms: MemoryRoomRepository) {
  rooms.addRoom(CODE, {
    name: 'Team sync',
    created_at: '2026-11-13T09:00:00.000Z',
    expires_at: '2026-11-14T09:00:00.000Z',
    ttl_hours: 24,
    created_by: 'uidCreatorAAAAAAAAAAAAAAAAAA',
    creator_tz: 'Asia/Karachi',
  });
  rooms.addMessage(CODE, 'm1', {
    kind: 'chat',
    content: 'TOP-SECRET-TEXT',
    sender_name: 'Sender Sara',
    reply_to: { snippet: 'reply snippet text' },
    attachment: { key: 'chat/AB7KQ2MZ/key-1', name: 'secret-file-name.pdf', size: 1200, mime_type: 'application/pdf' },
  });
  rooms.addMessage(CODE, 'm2', {
    kind: 'chat',
    content: '',
    attachment: { key: 'chat/AB7KQ2MZ/v', name: 'voice.webm', size: 300, mime_type: 'audio/webm', voice: { duration_ms: 1500 } },
  });
  rooms.addMessage(CODE, 's1', { kind: 'system', content: 'joined', sender_name: 'Sender Sara' });
  rooms.addPresence(CODE, 'device-a', '2026-11-13T11:59:00.000Z');
  rooms.addPresence(CODE, 'device-b', '2026-11-13T11:00:00.000Z');
}

describe('rooms screen DTOs (counts only)', () => {
  let rooms: MemoryRoomRepository;
  let service: RoomService;

  beforeEach(() => {
    rooms = new MemoryRoomRepository();
    seed(rooms);
    service = new RoomService({
      reader: rooms,
      closer: rooms,
      history: new MemoryRoomHistoryRepository(),
      audit: new AuditService(new MemoryAuditRepository()),
      storage: { prefixUsage: async (prefix) => (prefix === `chat/${CODE}/` ? { objects: 2, bytes: 1500 } : { objects: 0, bytes: 0 }) },
      now: () => NOW,
      logger: { error: vi.fn() },
    });
  });

  it('a list row has counts, sizes and times, and nothing else', async () => {
    const room = await service.get(CODE);
    const row = await buildRoomRow(service, room!);
    expect(row).toEqual({
      code: CODE,
      name: 'Team sync',
      ttlHours: 24,
      createdAt: '2026-11-13T09:00:00.000Z',
      expiresAt: '2026-11-14T09:00:00.000Z',
      createdBy: 'uidCreatorAAAAAAAAAAAAAAAAAA',
      onlineCount: 1,
      messageCount: 2,
      fileCount: 2,
      totalBytes: 1500,
    });
    const json = JSON.stringify(row);
    for (const secret of SECRETS) expect(json).not.toContain(secret);
  });

  it('the detail adds voice count and time zone only; every key is on the allowlist', async () => {
    const detail = await buildRoomDetail(service, (await service.get(CODE))!);
    expect(detail).toMatchObject({ voiceCount: 1, creatorTz: 'Asia/Karachi', messageCount: 2 });
    expect(Object.keys(detail).sort()).toEqual([...ROOM_DETAIL_KEYS].sort());
    const json = JSON.stringify(detail);
    for (const secret of SECRETS) expect(json).not.toContain(secret);
  });

  it('a number that fails to load is null; the row still shows', async () => {
    rooms.onlineCount = async () => {
      throw new Error('read cap');
    };
    const failing = new RoomService({
      reader: rooms,
      closer: rooms,
      history: new MemoryRoomHistoryRepository(),
      audit: new AuditService(new MemoryAuditRepository()),
      storage: {
        prefixUsage: async () => {
          throw new Error('R2 down');
        },
      },
      now: () => NOW,
    });
    const row = await buildRoomRow(failing, (await failing.get(CODE))!);
    expect(row).toMatchObject({ code: CODE, onlineCount: null, messageCount: 2, fileCount: null, totalBytes: null });
  });

  it('history rows carry only the allowlisted keys', async () => {
    const history = new MemoryRoomHistoryRepository();
    const closing = new RoomService({ reader: rooms, closer: rooms, history, audit: new AuditService(new MemoryAuditRepository()), now: () => NOW });
    rooms.addObject(CODE, 'chat/AB7KQ2MZ/key-1', 1200);
    await closing.closeRoom({ uid: 'uidOwnerAAAAAAAAAAAAAAAAAAAA', email: 'o@example.com', role: 'owner', authTime: 1 }, CODE);
    const [entry] = (await history.listClosed({ limit: 5 })).rooms;
    const row = toRoomHistoryRow(entry);
    expect(Object.keys(row).sort()).toEqual([...ROOM_HISTORY_KEYS].sort());
    expect(row).toMatchObject({ code: CODE, messageCount: 2, fileCount: 1, totalBytes: 1200, voiceCount: 1, peakOnline: 1 });
    const json = JSON.stringify(row);
    for (const secret of SECRETS) expect(json).not.toContain(secret);
  });

  it('mapLimit keeps order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(await mapLimit([], 5, async () => 1)).toEqual([]);
  });
});
