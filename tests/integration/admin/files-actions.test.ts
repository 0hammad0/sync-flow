import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminContext } from '@/server/auth/types';
import { ForbiddenError, UnauthorizedError } from '@/server/errors';
import { AuditService } from '@/server/services/audit-service';
import { FileService } from '@/server/services/file-service';
import { chatId, shareId, testFileIds } from '../../support/file-ids';
import { MemoryFileRepository } from '../../support/in-memory/memory-file-repository';
import { MemoryStorage } from '../../support/in-memory/memory-misc-repositories';
import { MemoryAuditRepository } from '../../support/memory-audit-repository';

// The Files server actions end to end over in-memory stores: block check →
// requireAdmin('files:delete') → step-up → zod → FileService → audit.

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  assertNotBlocked: vi.fn(),
  updateTag: vi.fn(),
  container: null as unknown,
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9', 'user-agent': 'test-agent' }),
}));
vi.mock('next/cache', () => ({ updateTag: mocks.updateTag, unstable_cache: <T>(fn: T) => fn }));
vi.mock('@/server/auth/require-admin', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/server/blocklist/assert-not-blocked', () => ({ assertNotBlocked: mocks.assertNotBlocked }));
vi.mock('@/server/container', () => ({ getContainer: () => mocks.container }));

const { deleteFile, deleteFiles } = await import('@/features/admin/files/actions');

const NAME = 'ZEBRA-PAYROLL';
const TOKEN = 'aaaabbbbccccddddeeeeffff00001111';
const nowSec = () => Math.floor(Date.now() / 1000);
const fresh = (): AdminContext => ({ uid: 'mod1', email: 'mod@example.com', role: 'moderator', authTime: nowSec() - 60 });

let repo: MemoryFileRepository;
let storage: MemoryStorage;
let audit: MemoryAuditRepository;

beforeEach(() => {
  vi.clearAllMocks();
  repo = new MemoryFileRepository(testFileIds);
  for (const token of [TOKEN, 'bbbb0000']) {
    repo.addShare(token, {
      file_path: `${token}/${NAME}.pdf`,
      original_name: `${NAME}.pdf`,
      size: 100,
      mime_type: 'application/pdf',
      owner_id: 'u1',
      created_at: '2026-11-13T10:00:00.000Z',
      is_encrypted: false,
      expires_at: null,
      max_downloads: null,
      download_count: 0,
    });
  }
  repo.addMessage('AB7KQ2MZ', 'm1', {
    content: 'SECRET TEXT',
    created_at: '2026-11-13T11:00:00.000Z',
    sender_name: 'Ali',
    sender_id: null,
    attachments: [{ key: `chat/AB7KQ2MZ/${NAME}.png`, name: `${NAME}.png`, size: 20, mime_type: 'image/png' }],
  });
  storage = new MemoryStorage();
  audit = new MemoryAuditRepository();
  mocks.container = { files: new FileService({ reader: repo, remover: repo, storage, audit: new AuditService(audit), logger: { error: vi.fn() } }) };
  mocks.assertNotBlocked.mockResolvedValue(null);
  mocks.requireAdmin.mockResolvedValue(fresh());
});

async function rows() {
  return (await audit.list({ limit: 100 })).entries;
}

describe('deleteFile action', () => {
  it('checks the blocklist first and stops a blocked admin before anything else', async () => {
    mocks.assertNotBlocked.mockResolvedValue({ ref: 'REF123' });
    expect(await deleteFile({ id: shareId(TOKEN) })).toEqual({ ok: false, error: 'blocked', ref: 'REF123' });
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(storage.deleted).toEqual([]);
  });

  it("requires files:delete (a viewer's ForbiddenError, a signed-out UnauthorizedError)", async () => {
    mocks.requireAdmin.mockRejectedValueOnce(new ForbiddenError({ permission: 'files:delete' }));
    expect(await deleteFile({ id: shareId(TOKEN) })).toEqual({ ok: false, error: 'forbidden' });
    mocks.requireAdmin.mockRejectedValueOnce(new UnauthorizedError('no_session'));
    expect(await deleteFile({ id: shareId(TOKEN) })).toEqual({ ok: false, error: 'unauthorized' });
    expect(mocks.requireAdmin).toHaveBeenCalledWith('files:delete');
    expect(storage.deleted).toEqual([]);
  });

  it('needs a sign-in from the last 15 minutes (step-up) before any side effect', async () => {
    mocks.requireAdmin.mockResolvedValue({ ...fresh(), authTime: nowSec() - 16 * 60 });
    const result = await deleteFile({ id: shareId(TOKEN) });
    expect(result).toMatchObject({ ok: false, error: 'step_up_required' });
    expect(storage.deleted).toEqual([]);
    expect(repo.shares.has(TOKEN)).toBe(true);
    expect(await rows()).toEqual([]);
  });

  it('rejects anything but an opaque id, including the old s_<token> form', async () => {
    for (const id of [`s_${TOKEN}`, '', 42, null]) {
      expect(await deleteFile({ id })).toMatchObject({ ok: false, error: 'invalid' });
    }
    expect(storage.deleted).toEqual([]);
  });

  it('deletes R2 first, then the record, writes one audit row without name or token, and refreshes the list', async () => {
    const id = shareId(TOKEN);
    expect(await deleteFile({ id, reason: 'spam' })).toEqual({ ok: true, data: { id } });
    expect(storage.deleted).toEqual([`${TOKEN}/${NAME}.pdf`]);
    expect(repo.shares.has(TOKEN)).toBe(false);
    const [row] = await rows();
    expect(row).toMatchObject({ action: 'file.delete', targetId: id, actorUid: 'mod1', reason: 'spam', ip: '203.0.113.9', userAgent: 'test-agent' });
    const json = JSON.stringify(row);
    expect(json).not.toContain(NAME);
    expect(json).not.toContain(TOKEN);
    expect(mocks.updateTag).toHaveBeenCalledWith('files');
  });

  it('removes a chat attachment and leaves the message text alone', async () => {
    expect((await deleteFile({ id: chatId('AB7KQ2MZ', 'm1', 0) })).ok).toBe(true);
    expect(repo.messages[0].doc.content).toBe('SECRET TEXT');
    expect(JSON.stringify(await rows())).not.toMatch(/ZEBRA|SECRET TEXT/);
  });

  it('answers not_found for a file that is already gone', async () => {
    expect(await deleteFile({ id: shareId('ffff') })).toMatchObject({ ok: false, error: 'not_found', message: 'This file was already deleted.' });
  });

  it('keeps the record when R2 fails, and logs no key, name or token', async () => {
    storage.failKeys.add(`${TOKEN}/${NAME}.pdf`);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await deleteFile({ id: shareId(TOKEN) });
    expect(result).toMatchObject({ ok: false, error: 'internal', errorId: expect.any(String) });
    expect(repo.shares.has(TOKEN)).toBe(true);
    expect(await rows()).toEqual([]);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/ZEBRA|aaaabbbb/);
    log.mockRestore();
  });
});

describe('deleteFiles action', () => {
  it('one audit row per deleted file with a shared batchId, partial results', async () => {
    const ids = [shareId(TOKEN), shareId('bbbb0000'), shareId('gone')];
    const result = await deleteFiles({ ids });
    expect(result).toEqual({ ok: true, data: { deleted: ids.slice(0, 2), missing: [ids[2]], failed: [] } });
    const audited = await rows();
    expect(audited).toHaveLength(2);
    expect(new Set(audited.map((r) => (r.after as { batchId: string }).batchId)).size).toBe(1);
    expect(JSON.stringify(audited)).not.toContain(NAME);
  });

  it('caps a bulk delete at 100 files and still needs step-up', async () => {
    expect(await deleteFiles({ ids: Array(101).fill(shareId(TOKEN)) })).toMatchObject({ ok: false, error: 'invalid' });
    mocks.requireAdmin.mockResolvedValue({ ...fresh(), authTime: 0 });
    expect(await deleteFiles({ ids: [shareId(TOKEN)] })).toMatchObject({ ok: false, error: 'step_up_required' });
    expect(storage.deleted).toEqual([]);
  });
});
