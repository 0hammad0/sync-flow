import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminContext } from '@/server/auth/types';
import type { QuotaDecision, QuotaKind, QuotaMeter } from '@/server/quota/quota-guard';
import { FirestoreAuditRepository } from '@/server/repositories/firestore/audit-repository';
import { FirestoreFileRepository } from '@/server/repositories/firestore/file-repository';
import { AuditService } from '@/server/services/audit-service';
import { FileService } from '@/server/services/file-service';
import { auditListQuery, auditScope } from '@/features/admin/audit/queries';
import { clearEmulatorFirestore, emulatorAdminDb, hasFirestoreEmulator } from '../../support/firestore-emulator';
import { shareId, testFileIds } from '../../support/file-ids';
import { MemoryStorage } from '../../support/in-memory/memory-misc-repositories';

// Files & storage and Audit log screens against the Firestore emulator.
// Skips without FIRESTORE_EMULATOR_HOST (no Java locally); CI runs it.

vi.mock('next/cache', () => ({ unstable_cache: <T>(fn: T) => fn, updateTag: vi.fn() }));

class Meter implements QuotaMeter {
  reads = 0;
  record(kind: QuotaKind, count = 1) {
    if (kind === 'reads') this.reads += count;
  }
  async canWrite(): Promise<QuotaDecision> {
    return 'ok';
  }
  async assertCan(): Promise<QuotaDecision> {
    return 'ok';
  }
  noteError() {
    return false;
  }
}

const NAME = 'ZEBRA-PAYROLL.pdf';
const TOKEN = '0123456789abcdef0123456789abcdef';
const owner: AdminContext = { uid: 'owner1', email: 'o@example.com', role: 'owner', authTime: 1 };
const mod: AdminContext = { uid: 'mod1', email: 'm@example.com', role: 'moderator', authTime: 1 };

describe.skipIf(!hasFirestoreEmulator)('Firestore emulator: files and audit screens', { timeout: 30_000 }, () => {
  let env: ReturnType<typeof emulatorAdminDb>;
  let meter: Meter;
  let auditRepo: FirestoreAuditRepository;
  let files: FirestoreFileRepository;

  beforeAll(() => {
    env = emulatorAdminDb('files-audit-screens-test');
  });

  afterAll(async () => {
    await env?.close();
  });

  beforeEach(async () => {
    await clearEmulatorFirestore();
    meter = new Meter();
    auditRepo = new FirestoreAuditRepository(env.db, meter);
    files = new FirestoreFileRepository(env.db, meter, testFileIds);
    await env.db.collection('files').doc(TOKEN).set({
      id: TOKEN,
      token: TOKEN,
      file_path: `${TOKEN}/${NAME}`,
      original_name: NAME,
      size: 1234,
      mime_type: 'application/pdf',
      owner_id: null,
      created_at: '2026-11-13T10:00:00.000Z',
      is_encrypted: false,
      expires_at: null,
      max_downloads: null,
      download_count: 0,
    });
  });

  it('lists a share file by opaque id without its name or token, one read per doc', async () => {
    const page = await files.list({ kind: 'share', limit: 25 }, new Date());
    expect(page.files.map((f) => f.id)).toEqual([shareId(TOKEN)]);
    expect(JSON.stringify(page)).not.toMatch(/ZEBRA|0123456789abcdef/);
    expect(meter.reads).toBe(1);
  });

  it('deletes through FileService and writes a file.delete row with no name or token', async () => {
    const storage = new MemoryStorage();
    const service = new FileService({ reader: files, remover: files, storage, audit: new AuditService(auditRepo) });
    const result = await service.deleteFile(mod, shareId(TOKEN));
    expect(result.ok).toBe(true);
    expect(storage.deleted).toEqual([`${TOKEN}/${NAME}`]);
    expect((await env.db.collection('files').doc(TOKEN).get()).exists).toBe(false);
    const stored = (await env.db.collection('admin_audit').get()).docs.map((d) => d.data());
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ action: 'file.delete', target_id: shareId(TOKEN), actor_uid: 'mod1' });
    expect(JSON.stringify(stored)).not.toMatch(/ZEBRA|0123456789abcdef/);
  });

  it("a moderator's audit query returns only their rows, even with ?actor= someone else", async () => {
    const base = { actorEmail: null, actorRole: 'owner' as const, targetType: null, targetId: null, before: null, after: null, reason: null, ip: null, userAgent: null };
    await auditRepo.append({ ...base, actorUid: 'owner1', action: 'block.create' });
    await auditRepo.append({ ...base, actorUid: 'mod1', actorRole: 'moderator', action: 'file.delete' });
    await auditRepo.append({ ...base, actorUid: 'mod1', actorRole: 'moderator', action: 'block.remove' });

    const now = Date.now();
    const modPage = await auditRepo.list(auditListQuery(auditScope(mod, { actor: 'owner1' }), '30d', null, now));
    expect(modPage.entries.map((e) => e.actorUid)).toEqual(['mod1', 'mod1']);

    const modAction = await auditRepo.list(auditListQuery(auditScope(mod, { action: 'file.delete' }), '30d', null, now));
    expect(modAction.entries.map((e) => e.action)).toEqual(['file.delete']);

    const ownerPage = await auditRepo.list(auditListQuery(auditScope(owner, {}), '30d', null, now));
    expect(ownerPage.entries).toHaveLength(3);
  });
});
