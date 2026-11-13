import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createCronRunRecorder } from '@/server/cron/record-cron-run';
import { FirestoreRoomHistoryRepository } from '@/server/repositories/firestore/room-history-repository';
import { CHAT_FILE_FIELDS } from '@/server/repositories/admin-files';
import type { NewCronRun } from '@/server/repositories/interfaces';
import { CF_GRAPHQL_URL, R2StorageRepository } from '@/server/repositories/r2/storage-repository';
import type { QuotaDecision, QuotaMeter } from '@/server/quota/quota-guard';
import { MISSED_RUN_MS, cronCheck, type CronRunDto } from '@/features/admin/health/cron-status';
import type { Firestore } from 'firebase-admin/firestore';

describe('R2StorageRepository.bucketTotals', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');

  it('is null (not configured) without CF_ACCOUNT_ID / CF_API_TOKEN, and makes no call', async () => {
    const fetch = vi.fn();
    const repo = new R2StorageRepository({ accountId: '', apiToken: '', fetch });
    expect(await repo.bucketTotals(now)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads the latest r2StorageAdaptiveGroups sample with a bearer token', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        data: {
          viewer: {
            accounts: [
              {
                r2StorageAdaptiveGroups: [
                  { max: { objectCount: 12408, payloadSize: 6_210_000_000 }, dimensions: { datetime: '2026-11-13T11:00:00Z' } },
                ],
              },
            ],
          },
        },
      }),
    );
    const repo = new R2StorageRepository({ accountId: 'acc', apiToken: 'tok', bucket: 'b', fetch });
    expect(await repo.bucketTotals(now)).toEqual({
      objectCount: 12408,
      payloadBytes: 6_210_000_000,
      measuredAt: new Date('2026-11-13T11:00:00Z'),
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CF_GRAPHQL_URL);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(String(init.body)).variables).toMatchObject({ accountTag: 'acc', bucket: 'b' });
  });

  it('throws on HTTP and GraphQL errors (the screen shows "Could not load R2 totals")', async () => {
    const bad = new R2StorageRepository({ accountId: 'a', apiToken: 't', fetch: vi.fn(async () => new Response('', { status: 403 })) });
    await expect(bad.bucketTotals(now)).rejects.toThrow('403');
    const gqlError = new R2StorageRepository({
      accountId: 'a',
      apiToken: 't',
      fetch: vi.fn(async () => Response.json({ data: null, errors: [{ message: 'not authorized' }] })),
    });
    await expect(gqlError.bucketTotals(now)).rejects.toThrow('not authorized');
  });
});

describe('recordCronRun', () => {
  const run: NewCronRun = { job: 'cleanup', startedAt: new Date(), finishedAt: new Date(), status: 'ok', result: {}, errorId: null };

  it('returns the row id', async () => {
    const record = createCronRunRecorder({ repo: () => ({ append: async () => 'id-1', listRecent: async () => [] }) });
    expect(await record(run)).toBe('id-1');
  });

  it('never throws: a failed write or a failed container start is logged and swallowed', async () => {
    const logger = { error: vi.fn() };
    const failingWrite = createCronRunRecorder({
      repo: () => ({ append: async () => Promise.reject(new Error('down')), listRecent: async () => [] }),
      logger,
    });
    await expect(failingWrite(run)).resolves.toBeNull();
    const failingStart = createCronRunRecorder({
      repo: () => {
        throw new Error('Missing Firebase Admin credentials');
      },
      logger,
    });
    await expect(failingStart(run)).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});

describe('cronCheck (Health)', () => {
  const now = Date.parse('2026-11-13T12:00:00.000Z');
  const runAt = (agoMs: number, extra: Partial<CronRunDto> = {}): CronRunDto => ({
    id: String(agoMs),
    startedAt: new Date(now - agoMs).toISOString(),
    finishedAt: new Date(now - agoMs + 1000).toISOString(),
    durationMs: 1000,
    status: 'ok',
    filesDeleted: 1,
    roomsDeleted: 0,
    sessionsDeleted: 0,
    filesFailed: 0,
    timeBudgetUsed: false,
    sessionsRolledUp: null,
    ipsNulled: null,
    stoppedAtCap: false,
    errorId: null,
    ...extra,
  });

  it('no rows = no data (not a fail)', () => {
    expect(cronCheck([], now)).toMatchObject({ status: 'no_data', missed: false });
  });

  it('missed run past 26 h exactly, not at it', () => {
    expect(cronCheck([runAt(MISSED_RUN_MS)], now)).toMatchObject({ status: 'ok', missed: false });
    expect(cronCheck([runAt(MISSED_RUN_MS + 1)], now)).toMatchObject({ status: 'fail', missed: true });
  });

  it('error fails, partial or failed files warn, two budget hits in a row warn', () => {
    expect(cronCheck([runAt(1000, { status: 'error' })], now).status).toBe('fail');
    expect(cronCheck([runAt(1000, { status: 'partial' })], now).status).toBe('warn');
    expect(cronCheck([runAt(1000, { filesFailed: 2 })], now).status).toBe('warn');
    expect(cronCheck([runAt(1000, { timeBudgetUsed: true })], now).status).toBe('ok');
    expect(cronCheck([runAt(1000, { timeBudgetUsed: true }), runAt(2000, { timeBudgetUsed: true })], now).status).toBe('warn');
  });
});

describe('FirestoreRoomHistoryRepository quota gate (no emulator)', () => {
  function stubDb() {
    const set = vi.fn(async () => undefined);
    const db = { collection: () => ({ doc: () => ({ set }) }) } as unknown as Firestore;
    return { db, set };
  }
  function meter(decision: QuotaDecision) {
    return { record: vi.fn(), canWrite: vi.fn(async () => decision), assertCan: vi.fn(), noteError: vi.fn(() => false) } satisfies QuotaMeter;
  }
  const room = { code: 'AAAAAAA1', name: null, createdAt: new Date(), expiresAt: new Date(), ttlHours: 1, createdBy: null };

  it('skips the write on stop and counts nothing', async () => {
    const { db, set } = stubDb();
    const m = meter('stop');
    expect(await new FirestoreRoomHistoryRepository(db, m).recordOpened(room)).toBe(false);
    expect(set).not.toHaveBeenCalled();
    expect(m.record).not.toHaveBeenCalled();
  });

  it('writes with merge and counts 1 write otherwise (sampling does not skip it)', async () => {
    const { db, set } = stubDb();
    const m = meter('sample');
    expect(await new FirestoreRoomHistoryRepository(db, m).recordOpened(room)).toBe(true);
    expect(set).toHaveBeenCalledWith(expect.not.objectContaining({ closed_at: expect.anything() }), { merge: true });
    expect(m.record).toHaveBeenCalledWith('writes', 1);
  });
});

/** Every file under `dir` (recursive). */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('D-4: admin code never reads content (static checks)', () => {
  const adminCode = ['src/features/admin', 'src/app/admin', 'src/server'].flatMap((d) => walk(d));

  it('no admin code signs a download URL or claims a download', () => {
    const hits = adminCode.filter((f) => /signedDownloadUrl|claimDownload|GetObjectCommand/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('the chat projection never includes message text', () => {
    expect(CHAT_FILE_FIELDS).not.toContain('content');
    expect(CHAT_FILE_FIELDS).not.toContain('reply_to');
    expect(CHAT_FILE_FIELDS).not.toContain('reactions');
  });

  it('repositories read messages only through select() or fieldMask', () => {
    for (const file of ['src/server/repositories/firestore/file-repository.ts', 'src/server/repositories/firestore/room-repository.ts']) {
      const src = readFileSync(file, 'utf8');
      // A full message read would be `.get()` on a message ref or an unprojected messages query.
      expect(src).not.toMatch(/messageRef\([^)]*\)\.get\(/);
      expect(src).not.toMatch(/'content'/);
    }
  });
});
