import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Room history write 1 runs inside after(): the visitor's response never
// waits for it, and a failure never changes the response.

const h = vi.hoisted(() => ({
  scheduled: [] as (() => unknown)[],
  recordRoomOpened: vi.fn(async () => undefined),
  room: {
    code: 'AB7KQ2MZ',
    name: null,
    created_at: '2026-11-13T00:00:00.000Z',
    expires_at: '2026-11-13T01:00:00.000Z',
    ttl_hours: 1 as const,
    created_by: null,
    creator_tz: 'UTC',
  },
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => {
    h.scheduled.push(task);
  },
}));
vi.mock('@/shared/lib/firebase/session', () => ({ currentUser: async () => null }));
vi.mock('@/shared/lib/firebase/chat', () => ({
  ALLOWED_TTL_HOURS: [1, 24, 168],
  MAX_ROOM_NAME_LENGTH: 80,
  createRoom: async () => h.room,
}));
vi.mock('@/server/rooms/room-history', () => ({ recordRoomOpened: h.recordRoomOpened }));

async function create() {
  const { POST } = await import('@/app/api/chat/route');
  return POST(
    new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({ ttlHours: 1 }),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200)}` },
    }),
  );
}

describe('POST /api/chat room history', () => {
  beforeEach(() => {
    h.scheduled.length = 0;
    h.recordRoomOpened.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers before the history write runs, then writes it after the response', async () => {
    const res = await create();
    expect(res.status).toBe(200);
    expect(h.recordRoomOpened).not.toHaveBeenCalled();
    expect(h.scheduled).toHaveLength(1);
    await h.scheduled[0]();
    expect(h.recordRoomOpened).toHaveBeenCalledWith(h.room);
  });
});
