import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileIdKeyError } from '@/server/files/file-id';
import { QuotaExceededError } from '@/server/quota/quota-guard';
import { AuditService } from '@/server/services/audit-service';
import { FileService } from '@/server/services/file-service';
import { chatId, shareId, testFileIds } from '../../../../support/file-ids';
import { MemoryFileRepository } from '../../../../support/in-memory/memory-file-repository';
import { MemoryStorage } from '../../../../support/in-memory/memory-misc-repositories';
import { MemoryAuditRepository } from '../../../../support/memory-audit-repository';

// Files queries with the real FileService over the in-memory repository.
// The no-name guarantee [D-6]: a distinctive stored name never reaches a DTO.

const SECRET_NAME = 'ZEBRA-QUARTERLY-PAYROLL';
const TOKEN = '9f1c2b3a4d5e6f708192a3b4c5d6e7f8';

const state = vi.hoisted(() => ({ container: null as unknown }));
vi.mock('next/cache', () => ({ unstable_cache: <T>(fn: T) => fn, updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/server/container', () => ({ getContainer: () => state.container }));

const { getFile, getStorageSummary, listFiles, toQueryFailure } = await import('@/features/admin/files/queries');

let repo: MemoryFileRepository;
let users: { get: ReturnType<typeof vi.fn> };

beforeEach(() => {
  repo = new MemoryFileRepository(testFileIds);
  repo.addShare(TOKEN, {
    file_path: `${TOKEN}/${SECRET_NAME}.pdf`,
    original_name: `${SECRET_NAME}.pdf`,
    size: 2_516_582,
    mime_type: 'application/pdf',
    owner_id: 'uid-sara',
    created_at: '2026-11-13T10:00:00.000Z',
    is_encrypted: false,
    expires_at: '2026-11-20T10:00:00.000Z',
    max_downloads: 10,
    download_count: 3,
  });
  repo.addMessage('AB7KQ2MZ', 'msg1', {
    content: 'hello',
    created_at: '2026-11-13T11:00:00.000Z',
    sender_name: 'Ali',
    sender_id: null,
    attachments: [
      { key: `chat/AB7KQ2MZ/${SECRET_NAME}.png`, name: `${SECRET_NAME}.png`, size: 300_000, mime_type: 'image/png' },
      { key: 'chat/AB7KQ2MZ/v.webm', name: `${SECRET_NAME}-voice.webm`, size: 1_000, mime_type: 'audio/webm', voice: { duration_ms: 4200 } },
    ],
  });
  users = { get: vi.fn(async (uid: string) => (uid === 'uid-sara' ? { uid, email: 'sara@example.com' } : null)) };
  const storage = new MemoryStorage();
  state.container = {
    files: new FileService({ reader: repo, remover: repo, storage, audit: new AuditService(new MemoryAuditRepository()) }),
    users,
  };
});

describe('listFiles', () => {
  it('returns metadata DTOs with opaque ids and never a name, key or token', async () => {
    const result = await listFiles({ kind: 'all', expired: false }, true);
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.rows.map((r) => r.id)).toEqual([chatId('AB7KQ2MZ', 'msg1', 0), chatId('AB7KQ2MZ', 'msg1', 1), shareId(TOKEN)]);
    const json = JSON.stringify(result);
    expect(json).not.toContain(SECRET_NAME);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain('hello');
    for (const row of result.rows) {
      expect(Object.keys(row).sort()).toEqual(
        ['createdAt', 'downloads', 'expiresAt', 'id', 'isEncrypted', 'kind', 'maxDownloads', 'mimeType', 'roomCode', 'size', 'type', 'uploader', 'voiceDurationMs'].sort(),
      );
    }
  });

  it('maps type, uploader and room', async () => {
    const result = await listFiles({ kind: 'all', expired: false }, true);
    if (result.state !== 'ok') throw new Error(result.state);
    const [image, voice, pdf] = result.rows;
    expect(image).toMatchObject({ type: 'image', kind: 'chat', roomCode: 'AB7KQ2MZ', uploader: { label: 'Ali (guest)', uid: null } });
    expect(voice).toMatchObject({ type: 'voice', voiceDurationMs: 4200 });
    expect(pdf).toMatchObject({ type: 'pdf', kind: 'share', roomCode: null, downloads: 3, maxDownloads: 10, uploader: { label: 'sara@example.com', uid: 'uid-sara' } });
  });

  it('skips email lookups without users:read', async () => {
    const result = await listFiles({ kind: 'share', expired: false }, false);
    if (result.state !== 'ok') throw new Error(result.state);
    expect(result.rows[0].uploader.label).toBe('Signed-in user');
    expect(users.get).not.toHaveBeenCalled();
  });

  it('maps failures to page states, never throwing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(toQueryFailure(new QuotaExceededError('reads', 'cap'), 'x')).toEqual({ state: 'budget' });
    expect(toQueryFailure(new FileIdKeyError(), 'x')).toEqual({ state: 'setup' });
    expect(toQueryFailure(Object.assign(new Error('needs index'), { code: 9 }), 'x')).toEqual({ state: 'index' });
    expect(toQueryFailure(new Error(`files/${TOKEN} gone`), 'x')).toMatchObject({ state: 'error', errorId: expect.any(String) });
  });

  it('never logs an error message (it can hold a doc path with the token)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    toQueryFailure(new Error(`No document: files/${TOKEN}`), 'get');
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });
});

describe('getFile', () => {
  it('returns one file by opaque id, and not_found for the old s_<token> id', async () => {
    const ok = await getFile(shareId(TOKEN), true);
    expect(ok).toMatchObject({ state: 'ok', file: { id: shareId(TOKEN), size: 2_516_582 } });
    expect(JSON.stringify(ok)).not.toContain(SECRET_NAME);
    expect(await getFile(`s_${TOKEN}`, true)).toEqual({ state: 'not_found' });
    expect(await getFile(shareId('0000'), true)).toEqual({ state: 'not_found' });
  });
});

describe('getStorageSummary', () => {
  it('reports share totals and the R2 parts it can, without failing the panel', async () => {
    const summary = await getStorageSummary();
    expect(summary.share).toEqual({ count: 1, bytes: 2_516_582 });
    expect(summary.bucket.state).toBeDefined();
    expect(JSON.stringify(summary)).not.toContain(SECRET_NAME);
  });
});
