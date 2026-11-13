import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Health v1: the cleanup cron writes one admin_cron_runs row per run, after
// the response, and the record can never fail the cleanup.

const h = vi.hoisted(() => ({
  afterImpl: (task: () => unknown) => {
    void task();
  },
  recordCronRun: vi.fn(async () => 'run-id'),
  deleteExpiredRooms: vi.fn(async () => 0),
  listExpiredAnonymousFiles: vi.fn(async (): Promise<{ token: string; file_path: string }[]> => []),
  deleteObject: vi.fn(async () => undefined),
  hooks: { beforeDelete: async () => null },
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => h.afterImpl(task),
}));
vi.mock('@/shared/lib/firebase/files', () => ({
  deleteExpiredReceiveSessions: vi.fn(async () => 2),
  deleteFile: vi.fn(async () => undefined),
  listExpiredAnonymousFiles: h.listExpiredAnonymousFiles,
}));
vi.mock('@/shared/lib/firebase/chat', () => ({ deleteExpiredRooms: h.deleteExpiredRooms }));
vi.mock('@/shared/lib/r2', () => ({ deleteObject: h.deleteObject }));
vi.mock('@/server/cron/record-cron-run', () => ({ recordCronRun: h.recordCronRun }));
vi.mock('@/server/rooms/room-history', () => ({ cronRoomHooks: () => h.hooks }));

async function call() {
  const { GET } = await import('@/app/api/cleanup/route');
  return GET(new NextRequest('http://localhost/api/cleanup', { headers: { authorization: 'Bearer s3cret' } }));
}

describe('/api/cleanup run record', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.afterImpl = (task) => {
      void task();
    };
    h.recordCronRun.mockClear();
    h.listExpiredAnonymousFiles.mockReset();
    h.listExpiredAnonymousFiles.mockResolvedValue([]);
    h.deleteObject.mockReset();
    h.deleteExpiredRooms.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('writes one ok row with counts, and passes the room history hooks to the room sweep', async () => {
    h.deleteExpiredRooms.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.deleteExpiredRooms).toHaveBeenCalledWith(h.hooks);
    expect(h.recordCronRun).toHaveBeenCalledTimes(1);
    expect(h.recordCronRun).toHaveBeenCalledWith(
      expect.objectContaining({
        job: 'cleanup',
        status: 'ok',
        errorId: null,
        result: expect.objectContaining({ roomsDeleted: 3, sessionsDeleted: 2, filesDeleted: 0, filesFailed: 0 }),
      }),
    );
  });

  it('a failed file makes the run partial and stores a count, never the share token', async () => {
    h.listExpiredAnonymousFiles.mockResolvedValueOnce([{ token: 'secret-token', file_path: 'secret-token/a.pdf' }]).mockResolvedValue([]);
    h.deleteObject.mockRejectedValueOnce(new Error('R2 down'));
    const res = await call();
    expect(res.status).toBe(200);
    const run = (h.recordCronRun.mock.calls[0] as unknown[])[0];
    expect(run).toMatchObject({ status: 'partial', result: { filesFailed: 1 } });
    expect(JSON.stringify(run)).not.toContain('secret-token');
  });

  it('an unexpected failure is recorded as error with an error id; the response stays 500', async () => {
    h.listExpiredAnonymousFiles.mockRejectedValue(new Error('Firestore down'));
    const res = await call();
    expect(res.status).toBe(500);
    expect(h.recordCronRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', errorId: expect.any(String) }));
  });

  it('never fails the cleanup when the record cannot be scheduled', async () => {
    h.afterImpl = () => {
      throw new Error('after() outside a request');
    };
    const res = await call();
    expect(res.status).toBe(200);
  });

  it('never deletes room history', () => {
    expect(readFileSync('src/app/api/cleanup/route.ts', 'utf8')).not.toContain('a_rooms');
  });
});
