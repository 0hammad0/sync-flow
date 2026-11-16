import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminContext } from '@/server/auth/types';
import { ConflictError } from '@/server/errors';
import { QuotaExceededError } from '@/server/quota/quota-guard';
import { AuditService } from '@/server/services/audit-service';
import { DataDeletionService, DELETE_RESERVE } from '@/server/services/data-deletion-service';
import { MemoryAuditRepository } from '../../../support/memory-audit-repository';
import { FakeQuota, MemorySubjectStore } from '../../../support/in-memory/memory-settings';

// 15-settings.md "Danger zone" + 08-privacy.md: delete one visitor's
// sessions (pages and clicks inside), counts first, never past the delete cap.

const owner: AdminContext = { uid: 'uidOwnerAAAAAAAAAAAAAAAAAAAA', email: 'owner@example.com', role: 'owner', authTime: 1 };
const IP = '203.0.113.9';
const UID = 'uidVisitorBBBBBBBBBBBBBBBBBB';
const ip = { kind: 'ip' as const, value: IP };
const uid = { kind: 'uid' as const, value: UID };

let quota: FakeQuota;
let store: MemorySubjectStore;
let auditRepo: MemoryAuditRepository;
let service: DataDeletionService;
const logger = { error: vi.fn() };

function seed(n: number, ipValue: string | null, user: string | null, prefix: string) {
  for (let i = 0; i < n; i += 1) store.sessions.push({ id: `${prefix}${i}`, ip: ipValue, user_id: user });
}

async function rows() {
  return (await auditRepo.list({ limit: 100 })).entries;
}

beforeEach(() => {
  logger.error.mockClear();
  quota = new FakeQuota();
  store = new MemorySubjectStore(quota);
  auditRepo = new MemoryAuditRepository();
  service = new DataDeletionService({ store, quota, audit: new AuditService(auditRepo), batchSize: 10, logger });
  seed(14, IP, null, 'a'); // the IP, signed out
  seed(3, IP, UID, 'b'); // the IP, signed in as UID
  seed(5, '198.51.100.1', UID, 'c'); // UID from another IP
  seed(7, '198.51.100.2', null, 'd'); // someone else
});

describe('DataDeletionService.preview', () => {
  it('counts sessions by exact IP or by uid, with 1 read, and deletes nothing', async () => {
    expect(await service.preview(ip)).toMatchObject({ sessions: 17, fits: true });
    expect(await service.preview(uid)).toMatchObject({ sessions: 8, fits: true });
    expect(quota.used).toMatchObject({ reads: 2, deletes: 0 });
    expect(store.sessions).toHaveLength(29);
  });

  it('reports the deletes left today (cap − used − reserve) and whether they cover it', async () => {
    quota.used.deletes = quota.caps.deletes - DELETE_RESERVE - 10;
    expect(await service.preview(ip)).toMatchObject({ sessions: 17, fits: false, budget: { deletes: 10 } });
  });

  it('refuses to count when no read is left', async () => {
    quota.used.reads = quota.caps.reads;
    await expect(service.preview(ip)).rejects.toBeInstanceOf(QuotaExceededError);
  });
});

describe('DataDeletionService.deleteSubject', () => {
  it('deletes every session for the IP in batches, leaves the rest, and writes one data.delete row with a masked target', async () => {
    const result = await service.deleteSubject(owner, ip, { request: { ip: '192.0.2.1', userAgent: 'ua' } });
    expect(result).toEqual({ ok: true, data: { needed: 17, deleted: 17, complete: true, stopped: null, errorId: null } });
    expect(store.batches).toEqual([10, 7]);
    expect(store.sessions.map((s) => s.id[0]).sort()).toEqual([...'cccccddddddd']);
    expect(quota.used.deletes).toBe(17);

    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      action: 'data.delete',
      actorUid: owner.uid,
      targetType: 'ip',
      targetId: '203.0.113.•••',
      before: { sessions: 17 },
      after: { sessions_deleted: 17, complete: true, stopped: null },
      ip: '192.0.2.1',
    });
    expect(JSON.stringify(all[0])).not.toContain(IP);
  });

  it('scopes a uid delete to user_id only and masks the uid to a prefix', async () => {
    const result = await service.deleteSubject(owner, uid);
    expect(result).toMatchObject({ ok: true, data: { needed: 8, deleted: 8, complete: true } });
    expect(store.sessions.filter((s) => s.user_id === UID)).toEqual([]);
    expect(store.sessions).toHaveLength(21);
    const [row] = await rows();
    expect(row).toMatchObject({ targetType: 'uid', targetId: 'uidVis•••' });
    expect(JSON.stringify(row)).not.toContain(UID);
  });

  it('refuses before deleting anything when today’s deletes cannot cover the count', async () => {
    quota.used.deletes = quota.caps.deletes - DELETE_RESERVE - 16;
    const result = await service.deleteSubject(owner, ip);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ConflictError);
    expect(result.error.message).toBe('This needs 17 deletes; 16 are left today. Try again after 00:00 UTC.');
    expect(store.batches).toEqual([]);
    expect(store.sessions).toHaveLength(29);
    expect(await rows()).toEqual([]);
  });

  it('refuses when the reads for the batch queries are not left either', async () => {
    quota.used.reads = quota.caps.reads - DELETE_RESERVE - 18; // 17 docs + 2 queries + final = 20 needed
    expect((await service.deleteSubject(owner, ip)).ok).toBe(false);
    expect(store.sessions).toHaveLength(29);
  });

  it('stops with a partial result when the cap gets near mid-run (others spending too), never past it', async () => {
    // Another instance spends deletes between our batches: after the first batch only 3 are left.
    let calls = 0;
    quota.onUsage = () => {
      calls += 1;
      if (calls === 3) quota.used.deletes = quota.caps.deletes - DELETE_RESERVE - 3;
    };
    const result = await service.deleteSubject(owner, ip);
    expect(result).toEqual({ ok: true, data: { needed: 17, deleted: 13, complete: false, stopped: 'cap', errorId: null } });
    expect(store.batches).toEqual([10, 3]);
    expect(quota.used.deletes).toBeLessThanOrEqual(quota.caps.deletes - DELETE_RESERVE);
    const [row] = await rows();
    expect(row.after).toEqual({ sessions_deleted: 13, complete: false, stopped: 'cap' });
  });

  it('a Firestore failure mid-run keeps what was deleted, audits it, and logs no IP', async () => {
    store.failOnBatch = 2;
    const result = await service.deleteSubject(owner, ip);
    expect(result).toMatchObject({ ok: true, data: { needed: 17, deleted: 10, complete: false, stopped: 'error' } });
    if (!result.ok) return;
    expect(result.data.errorId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await rows())[0].after).toEqual({ sessions_deleted: 10, complete: false, stopped: 'error' });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(IP);
  });

  it('nothing found → nothing deleted, no audit row', async () => {
    const result = await service.deleteSubject(owner, { kind: 'ip', value: '192.0.2.200' });
    expect(result).toEqual({ ok: true, data: { needed: 0, deleted: 0, complete: true, stopped: null, errorId: null } });
    expect(store.batches).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it('Firestore said RESOURCE_EXHAUSTED → no budget at all', async () => {
    quota.stoppedUntil = Date.now() + 60_000;
    await expect(service.deleteSubject(owner, ip)).rejects.toBeInstanceOf(QuotaExceededError);
    expect(store.sessions).toHaveLength(29);
  });

  it('batches never exceed 500 (Firestore batch limit), whatever is configured', async () => {
    const big = new DataDeletionService({ store, quota, audit: new AuditService(auditRepo), batchSize: 10_000, logger });
    store.sessions = [];
    seed(1_200, IP, null, 'x');
    const result = await big.deleteSubject(owner, ip);
    expect(result).toMatchObject({ ok: true, data: { deleted: 1_200, complete: true } });
    expect(store.batches).toEqual([500, 500, 200]);
  });
});
