import { beforeEach, describe, expect, it } from 'vitest';

import type { RoomCloser, RoomReader } from '@/server/repositories/interfaces';

type Raw = Record<string, unknown>;
export type RoomSeed = {
  code: string;
  doc: Raw;
  messages: { id: string; doc: Raw }[];
  presence: { id: string; lastSeen: string }[];
}[];

export const NOW = new Date('2026-11-13T12:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const H = 3_600_000;

function room(code: string, createdAgoH: number, expiresInMs: number, ttl: number): Raw {
  return {
    code,
    name: `Room ${code}`,
    created_at: at(-createdAgoH * H),
    expires_at: at(expiresInMs),
    ttl_hours: ttl,
    created_by: null,
    creator_tz: 'UTC',
  };
}

const msg = (fields: Raw): Raw => ({
  sender_name: 'Ali',
  sender_id: null,
  content: 'SECRET',
  created_at: at(-60_000),
  sender_tz: 'UTC',
  kind: 'chat',
  attachment: null,
  attachments: null,
  ...fields,
});

/** R1 live (2 h left, ttl 24), R2 expiring (30 min, ttl 1), R3 expired (ttl 1). */
export const ROOM_SEED: RoomSeed = [
  {
    code: 'RRRRRRR1',
    doc: room('RRRRRRR1', 3, 2 * H, 24),
    messages: [
      { id: 'a', doc: msg({}) },
      { id: 'b', doc: msg({ kind: 'system', content: 'joined' }) },
      {
        id: 'c',
        doc: msg({
          content: '',
          attachment: { key: 'chat/RRRRRRR1/v', name: 'v.webm', size: 30, mime_type: 'audio/webm', voice: { duration_ms: 900 } },
        }),
      },
      { id: 'd', doc: msg({ attachments: [{ key: 'k1', name: 'p.png', size: 10, mime_type: 'image/png' }, { key: 'k2', name: 'q.png', size: 20, mime_type: 'image/png' }] }) },
      { id: 'e', doc: msg({ attachment: { key: 'k3', name: 'long.txt', size: 99, mime_type: 'text/plain', is_long_text: true } }) },
    ],
    presence: [
      { id: 'p1', lastSeen: at(-60_000) },
      { id: 'p2', lastSeen: at(-10 * 60_000) },
    ],
  },
  { code: 'RRRRRRR2', doc: room('RRRRRRR2', 2, 30 * 60_000, 1), messages: [], presence: [] },
  { code: 'RRRRRRR3', doc: room('RRRRRRR3', 1, -60_000, 1), messages: [], presence: [] },
];

type Repo = RoomReader & RoomCloser;

export function runRoomRepositoryContract(name: string, make: (seed: RoomSeed) => Promise<Repo>) {
  describe(`Room repository contract: ${name}`, () => {
    let repo: Repo;

    beforeEach(async () => {
      repo = await make(ROOM_SEED);
    });

    async function codes(query: Parameters<Repo['list']>[0]): Promise<string[]> {
      const out: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 10; i++) {
        const page = await repo.list({ ...query, cursor }, NOW);
        expect(JSON.stringify(page)).not.toContain('SECRET');
        out.push(...page.rooms.map((r) => r.code));
        if (!page.nextCursor) return out;
        cursor = page.nextCursor;
      }
      throw new Error('too many pages');
    }

    it('lists live rooms soonest expiry first, expiring ones, and all newest first', async () => {
      expect(await codes({ limit: 1 })).toEqual(['RRRRRRR2', 'RRRRRRR1']);
      expect(await codes({ status: 'expiring', limit: 25 })).toEqual(['RRRRRRR2']);
      expect(await codes({ status: 'all', limit: 2 })).toEqual(['RRRRRRR3', 'RRRRRRR2', 'RRRRRRR1']);
      expect(await codes({ status: 'all', ttlHours: 1, limit: 25 })).toEqual(['RRRRRRR3', 'RRRRRRR2']);
    });

    it('gets one room as metadata', async () => {
      expect(await repo.get('RRRRRRR1')).toMatchObject({ code: 'RRRRRRR1', name: 'Room RRRRRRR1', ttlHours: 24, creatorTz: 'UTC' });
      expect(await repo.get('ZZZZZZZZ')).toBeNull();
    });

    it('counts online people, messages and voice notes without reading text', async () => {
      expect(await repo.onlineCount('RRRRRRR1', new Date(NOW.getTime() - 3 * 60_000))).toBe(1);
      expect(await repo.counts('RRRRRRR1')).toEqual({ messageCount: 4, voiceCount: 1 });
      expect(await repo.counts('RRRRRRR2')).toEqual({ messageCount: 0, voiceCount: 0 });
    });

    it('sums attachments, skipping long-text bodies', async () => {
      expect(await repo.attachmentStats('RRRRRRR1')).toEqual({
        attachmentCount: 3,
        attachmentBytes: 60,
        voiceCount: 1,
        voiceBytes: 30,
      });
    });

    it('closes a room once', async () => {
      expect(await repo.close('RRRRRRR1')).not.toBeNull();
      expect(await repo.get('RRRRRRR1')).toBeNull();
      expect(await repo.close('RRRRRRR1')).toBeNull();
    });
  });
}
