import { beforeEach, describe, expect, it } from 'vitest';

import type { CronRunRepository, NewCronRun, RoomHistoryOpen, RoomHistoryRepository } from '@/server/repositories/interfaces';

const day = (d: number, h = 0) => new Date(Date.UTC(2026, 10, d, h));

function opened(code: string, d: number): RoomHistoryOpen {
  return { code, name: `Room ${code}`, createdAt: day(d), expiresAt: day(d + 1), ttlHours: 24, createdBy: null };
}

/** `a_rooms`: opens are not listed, closes are, newest close first. Writes merge. */
export function runRoomHistoryContract(name: string, make: () => Promise<RoomHistoryRepository>) {
  describe(`RoomHistoryRepository contract: ${name}`, () => {
    let repo: RoomHistoryRepository;

    beforeEach(async () => {
      repo = await make();
    });

    it('lists only closed rooms, newest close first, with paging', async () => {
      for (const [code, d] of [['AAAAAAA1', 1], ['AAAAAAA2', 2], ['AAAAAAA3', 3]] as const) {
        expect(await repo.recordOpened(opened(code, d))).toBe(true);
      }
      expect((await repo.listClosed({ limit: 10 })).rooms).toEqual([]);

      for (const [code, d] of [['AAAAAAA1', 5], ['AAAAAAA3', 4]] as const) {
        await repo.recordClosed({
          ...opened(code, 1),
          closedAt: day(d),
          closedBy: 'cron',
          messageCount: 7,
          attachmentCount: 2,
          attachmentBytes: 2048,
          voiceCount: null,
        });
      }
      const first = await repo.listClosed({ limit: 1 });
      expect(first.rooms.map((r) => r.code)).toEqual(['AAAAAAA1']);
      expect(first.rooms[0]).toMatchObject({
        closedBy: 'cron',
        messageCount: 7,
        attachmentCount: 2,
        attachmentBytes: 2048,
        voiceCount: null,
        peakOnline: null,
      });
      expect(first.rooms[0].closedAt.toISOString()).toBe(day(5).toISOString());
      const second = await repo.listClosed({ limit: 1, cursor: first.nextCursor });
      expect(second.rooms.map((r) => r.code)).toEqual(['AAAAAAA3']);
      const third = await repo.listClosed({ limit: 1, cursor: second.nextCursor });
      expect(third.rooms).toEqual([]);
      expect(third.nextCursor).toBeNull();
    });

    it('peak_online: raised only when higher, only for a known room, never lowered by a close', async () => {
      const room = opened('CCCCCCC1', 1);
      expect(await repo.notePeakOnline(room.code, 3)).toBe(false); // no history doc yet
      await repo.recordOpened(room);
      expect(await repo.notePeakOnline(room.code, 0)).toBe(false);
      expect(await repo.notePeakOnline(room.code, 3)).toBe(true);
      expect(await repo.notePeakOnline(room.code, 2)).toBe(false);
      expect(await repo.notePeakOnline(room.code, 3)).toBe(false);
      const close = { ...room, closedAt: day(2), closedBy: 'cron', messageCount: 0, attachmentCount: 0, attachmentBytes: 0, voiceCount: 0 };
      await repo.recordClosed({ ...close, onlineAtClose: 1 });
      expect((await repo.listClosed({ limit: 10 })).rooms[0].peakOnline).toBe(3);
      await repo.recordClosed({ ...close, onlineAtClose: 5 });
      expect((await repo.listClosed({ limit: 10 })).rooms[0].peakOnline).toBe(5);

      // A room never seen before gets its peak from the close write alone.
      await repo.recordClosed({ ...opened('CCCCCCC2', 1), closedAt: day(1), closedBy: 'cron', messageCount: 0, attachmentCount: 0, attachmentBytes: 0, voiceCount: 0, onlineAtClose: 2 });
      const rows = (await repo.listClosed({ limit: 10 })).rooms;
      expect(rows.find((r) => r.code === 'CCCCCCC2')?.peakOnline).toBe(2);
    });

    it('retention deletes only docs created before the cutoff, oldest first, up to the limit', async () => {
      for (const [code, d] of [['DDDDDDD1', 1], ['DDDDDDD2', 2], ['DDDDDDD3', 3], ['DDDDDDD4', 10]] as const) {
        await repo.recordOpened(opened(code, d));
        await repo.recordClosed({ ...opened(code, d), closedAt: day(d + 1), closedBy: 'cron', messageCount: 1, attachmentCount: 0, attachmentBytes: 0, voiceCount: 0 });
      }
      expect(await repo.deleteCreatedBefore(day(5), 2)).toBe(2);
      expect((await repo.listClosed({ limit: 10 })).rooms.map((r) => r.code).sort()).toEqual(['DDDDDDD3', 'DDDDDDD4']);
      expect(await repo.deleteCreatedBefore(day(5), 500)).toBe(1);
      expect(await repo.deleteCreatedBefore(day(5), 500)).toBe(0);
      expect((await repo.listClosed({ limit: 10 })).rooms.map((r) => r.code)).toEqual(['DDDDDDD4']);
    });

    it('a late "opened" write never undoes a close', async () => {
      const room = opened('BBBBBBB1', 1);
      await repo.recordClosed({ ...room, closedAt: day(2), closedBy: 'uid-owner', messageCount: 1, attachmentCount: 0, attachmentBytes: 0, voiceCount: 0 });
      await repo.recordOpened(room);
      const page = await repo.listClosed({ limit: 10 });
      expect(page.rooms.map((r) => [r.code, r.closedBy])).toEqual([['BBBBBBB1', 'uid-owner']]);
    });
  });
}

function run(job: NewCronRun['job'], d: number, extra: Partial<NewCronRun> = {}): NewCronRun {
  return {
    job,
    startedAt: day(d, 3),
    finishedAt: new Date(day(d, 3).getTime() + 1500),
    status: 'ok',
    result: { filesDeleted: d, timeBudgetUsed: false, note: null },
    errorId: null,
    ...extra,
  };
}

/** `admin_cron_runs`: newest first per job, round trip of every field. */
export function runCronRunContract(name: string, make: () => Promise<CronRunRepository>) {
  describe(`CronRunRepository contract: ${name}`, () => {
    let repo: CronRunRepository;

    beforeEach(async () => {
      repo = await make();
    });

    it('lists one job newest first, up to the limit', async () => {
      await repo.append(run('cleanup', 1));
      await repo.append(run('cleanup', 3, { status: 'error', errorId: 'err-1', result: {} }));
      await repo.append(run('rollup', 4));
      await repo.append(run('cleanup', 2, { status: 'partial' }));

      const runs = await repo.listRecent('cleanup', 2);
      expect(runs.map((r) => r.startedAt.getUTCDate())).toEqual([3, 2]);
      expect(runs[0]).toMatchObject({ job: 'cleanup', status: 'error', errorId: 'err-1', result: {} });
      expect(runs[1]).toMatchObject({ status: 'partial', result: { filesDeleted: 2, timeBudgetUsed: false, note: null } });
      expect(runs[1].finishedAt.getTime() - runs[1].startedAt.getTime()).toBe(1500);
      expect(typeof runs[0].id).toBe('string');
      expect(await repo.listRecent('retention', 5)).toEqual([]);
    });
  });
}
