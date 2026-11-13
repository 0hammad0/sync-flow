import { beforeEach, describe, expect, it } from 'vitest';

import type { FileReader, FileRemover } from '@/server/repositories/interfaces';

type Raw = Record<string, unknown>;
export type FileSeed = {
  shares: { token: string; doc: Raw }[];
  messages: { code: string; id: string; doc: Raw }[];
};

/** Message text that must never come back from the repository [D-4]. */
export const SECRET = 'SECRET-MESSAGE-TEXT';
export const NOW = new Date('2026-11-13T12:00:00.000Z');
const t = (day: number) => `2026-11-${String(day).padStart(2, '0')}T00:00:00.000Z`;

function share(day: number, size: number, owner: string | null, expires: string | null): Raw {
  return {
    id: 'x',
    token: 'x',
    file_path: `tok/${day}.pdf`,
    original_name: `file-${day}.pdf`,
    size,
    mime_type: 'application/pdf',
    owner_id: owner,
    created_at: t(day),
    is_encrypted: false,
    expires_at: expires,
    max_downloads: null,
    download_count: 0,
  };
}

const att = (key: string, size: number, extra: Raw = {}) => ({ key, name: `${key}.bin`, size, mime_type: 'image/png', ...extra });

function message(day: number, fields: Raw): Raw {
  return {
    sender_name: 'Ali',
    sender_id: null,
    content: SECRET,
    created_at: t(day),
    sender_tz: 'UTC',
    kind: 'chat',
    attachment: null,
    attachments: null,
    reply_to: { id: 'r', sender_name: 'Sara', snippet: SECRET, attachment_kind: null },
    ...fields,
  };
}

export const ROOM_A = 'AAAAAAAA';
export const ROOM_B = 'BBBBBBBB';

/** Newest first: m6, m5, s3, m2, s2, m1 (2 files), s1. m3 (long text) and m4 (no file) are not rows. */
export const FILE_SEED: FileSeed = {
  shares: [
    { token: 'tok1', doc: share(1, 100, 'u1', t(2)) },
    { token: 'tok2', doc: share(3, 200, null, '2026-12-01T00:00:00.000Z') },
    { token: 'tok3', doc: share(5, 50, 'u1', null) },
  ],
  messages: [
    { code: ROOM_A, id: 'm1', doc: message(2, { attachments: [att('chat/AAAAAAAA/a', 10), att('chat/AAAAAAAA/b', 20)] }) },
    {
      code: ROOM_A,
      id: 'm2',
      doc: message(4, { content: '', attachment: att('chat/AAAAAAAA/v', 30, { mime_type: 'audio/webm', voice: { duration_ms: 4200, peaks: [1, 2, 3] } }) }),
    },
    { code: ROOM_A, id: 'm3', doc: message(6, { attachment: att('chat/AAAAAAAA/long', 40, { is_long_text: true }) }) },
    { code: ROOM_A, id: 'm4', doc: message(7, {}) },
    { code: ROOM_A, id: 'm5', doc: message(8, { attachment: att('chat/AAAAAAAA/x', 50), attachments: [att('chat/AAAAAAAA/x', 50)] }) },
    { code: ROOM_B, id: 'm6', doc: message(9, { attachments: [att('chat/BBBBBBBB/y', 60)] }) },
  ],
};

const ALL_IDS = [
  `c_${ROOM_B}_m6_0`,
  `c_${ROOM_A}_m5_0`,
  's_tok3',
  `c_${ROOM_A}_m2_0`,
  's_tok2',
  `c_${ROOM_A}_m1_0`,
  `c_${ROOM_A}_m1_1`,
  's_tok1',
];

type Repo = FileReader & FileRemover;

/** One behaviour for every file repository. `make` returns a repo holding exactly FILE_SEED. */
export function runFileRepositoryContract(name: string, make: (seed: FileSeed) => Promise<Repo>) {
  describe(`File repository contract: ${name}`, () => {
    let repo: Repo;

    beforeEach(async () => {
      repo = await make(FILE_SEED);
    });

    async function listAll(query: Parameters<Repo['list']>[0]): Promise<string[]> {
      const ids: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const res = await repo.list({ ...query, cursor }, NOW);
        expect(JSON.stringify(res.files)).not.toContain(SECRET);
        ids.push(...res.files.map((f) => f.id));
        if (!res.nextCursor) return ids;
        cursor = res.nextCursor;
      }
      throw new Error('too many pages');
    }

    it('merges share files and chat attachments newest first, across pages, with no repeats', async () => {
      expect(await listAll({ limit: 3 })).toEqual(ALL_IDS);
      expect(await listAll({ limit: 25 })).toEqual(ALL_IDS);
    });

    it('never lists long-text bodies or messages without files, and never returns message text', async () => {
      const ids = await listAll({ limit: 25 });
      expect(ids.some((id) => id.includes('_m3_') || id.includes('_m4_'))).toBe(false);
    });

    it('filters by kind, owner, expiry and room', async () => {
      expect(await listAll({ kind: 'share', limit: 2 })).toEqual(['s_tok3', 's_tok2', 's_tok1']);
      expect(await listAll({ kind: 'chat', limit: 2 })).toEqual(ALL_IDS.filter((id) => id.startsWith('c_')));
      expect(await listAll({ ownerUid: 'u1', limit: 25 })).toEqual(['s_tok3', 's_tok1']);
      expect(await listAll({ expired: true, limit: 25 })).toEqual(['s_tok1']);
      expect(await listAll({ roomCode: ROOM_A, limit: 2 })).toEqual([
        `c_${ROOM_A}_m5_0`,
        `c_${ROOM_A}_m2_0`,
        `c_${ROOM_A}_m1_0`,
        `c_${ROOM_A}_m1_1`,
      ]);
    });

    it('maps metadata only', async () => {
      const voice = await repo.get(`c_${ROOM_A}_m2_0`);
      expect(voice).toMatchObject({ kind: 'chat', roomCode: ROOM_A, size: 30, voiceDurationMs: 4200, senderName: 'Ali' });
      expect(voice).not.toHaveProperty('key');
      const file = await repo.get('s_tok1');
      expect(file).toMatchObject({ kind: 'share', name: 'file-1.pdf', size: 100, uploaderUid: 'u1' });
      expect(JSON.stringify(file)).not.toContain('tok/1.pdf');
    });

    it('returns null for bad ids, long-text bodies and missing files', async () => {
      expect(await repo.get('nope')).toBeNull();
      expect(await repo.get(`c_${ROOM_A}_m3_0`)).toBeNull();
      expect(await repo.get('s_missing')).toBeNull();
      expect(await repo.storageKeyOf(`c_${ROOM_A}_m3_0`)).toBeNull();
    });

    it('sums share files with aggregates', async () => {
      expect(await repo.shareTotals()).toEqual({ count: 3, bytes: 350 });
      expect(await repo.ownerTotals('u1')).toEqual({ count: 2, bytes: 150 });
      expect(await repo.expiredOwnedTotals(NOW)).toEqual({ count: 1, bytes: 100 });
    });

    it('removes a share file record once', async () => {
      expect(await repo.storageKeyOf('s_tok1')).toBe('tok/1.pdf');
      expect(await repo.removeRecord('s_tok1', NOW)).toBe(true);
      expect(await repo.get('s_tok1')).toBeNull();
      expect(await repo.removeRecord('s_tok1', NOW)).toBe(false);
    });

    it('marks one chat attachment removed and keeps the rest of the album', async () => {
      const id = `c_${ROOM_A}_m1_1`;
      expect(await repo.storageKeyOf(id)).toBe('chat/AAAAAAAA/b');
      expect(await repo.removeRecord(id, NOW)).toBe(true);
      expect(await repo.get(id)).toBeNull();
      expect(await repo.storageKeyOf(id)).toBeNull();
      expect(await repo.removeRecord(id, NOW)).toBe(false);
      expect(await listAll({ roomCode: ROOM_A, limit: 25 })).toEqual([
        `c_${ROOM_A}_m5_0`,
        `c_${ROOM_A}_m2_0`,
        `c_${ROOM_A}_m1_0`,
      ]);
    });

    it('keeps the legacy single field in step for one-file sends', async () => {
      const id = `c_${ROOM_A}_m5_0`;
      expect(await repo.removeRecord(id, NOW)).toBe(true);
      expect(await repo.get(id)).toBeNull();
      expect(await listAll({ roomCode: ROOM_A, limit: 25 })).not.toContain(id);
    });
  });
}
