import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FirestoreQuotaStore, type QuotaDecision, type QuotaKind, type QuotaMeter } from '@/server/quota/quota-guard';
import { FirestoreAuditRepository } from '@/server/repositories/firestore/audit-repository';
import { runAuditRepositoryContract } from '../../unit/server/repositories/audit-repository.contract';
import { clearEmulatorFirestore, emulatorAdminDb, hasFirestoreEmulator } from '../../support/firestore-emulator';

/** Records what the repository reports, never blocks. */
class RecordingMeter implements QuotaMeter {
  recorded: { kind: QuotaKind; count: number }[] = [];
  decision: QuotaDecision = 'ok';
  record(kind: QuotaKind, count = 1) {
    this.recorded.push({ kind, count });
  }
  async canWrite() {
    return this.decision;
  }
  async assertCan() {
    if (this.decision === 'stop') throw new Error('stopped');
    return this.decision;
  }
  noteError() {
    return false;
  }
}

describe.skipIf(!hasFirestoreEmulator)('Firestore emulator: admin data', { timeout: 30_000 }, () => {
  let env: ReturnType<typeof emulatorAdminDb>;

  beforeAll(() => {
    env = emulatorAdminDb('audit-repository-test');
  });

  afterAll(async () => {
    await env?.close();
  });

  runAuditRepositoryContract('Firestore (emulator)', async () => {
    await clearEmulatorFirestore();
    return new FirestoreAuditRepository(env.db, new RecordingMeter());
  });

  describe('FirestoreAuditRepository quota reporting', () => {
    let meter: RecordingMeter;
    let repo: FirestoreAuditRepository;

    beforeEach(async () => {
      await clearEmulatorFirestore();
      meter = new RecordingMeter();
      repo = new FirestoreAuditRepository(env.db, meter);
    });

    it('reports 1 write per append and 1 read per row listed (minimum 1)', async () => {
      const entry = {
        actorUid: 'u',
        actorEmail: null,
        actorRole: 'owner' as const,
        action: 'auth.sign_in' as const,
        targetType: null,
        targetId: null,
        before: null,
        after: null,
        reason: null,
        ip: null,
        userAgent: null,
      };
      await repo.append(entry);
      await repo.append(entry);
      expect(meter.recorded).toEqual([
        { kind: 'writes', count: 1 },
        { kind: 'writes', count: 1 },
      ]);

      meter.recorded = [];
      await repo.list({ limit: 10 });
      await repo.list({ limit: 10, actorUid: 'nobody' });
      expect(meter.recorded).toEqual([
        { kind: 'reads', count: 2 },
        { kind: 'reads', count: 1 },
      ]);
    });

    it('refuses to list at the read cap, but still appends', async () => {
      meter.decision = 'stop';
      await expect(repo.list({ limit: 10 })).rejects.toThrow('stopped');
      await expect(
        repo.append({
          actorUid: 'u',
          actorEmail: null,
          actorRole: 'owner',
          action: 'settings.update',
          targetType: null,
          targetId: null,
          before: null,
          after: null,
          reason: null,
          ip: null,
          userAgent: null,
        }),
      ).resolves.toEqual(expect.any(String));
    });
  });

  describe('FirestoreQuotaStore', () => {
    beforeEach(async () => {
      await clearEmulatorFirestore();
    });

    it('reads zero for a missing day and default caps when settings are missing', async () => {
      const store = new FirestoreQuotaStore(env.db);
      expect(await store.read('2026-11-13', true)).toEqual({
        used: { reads: 0, writes: 0, deletes: 0 },
        caps: null,
      });
    });

    it('increments a_counters/{day} with one write and reads it back', async () => {
      const store = new FirestoreQuotaStore(env.db);
      await store.add('2026-11-13', { reads: 3, writes: 2, deletes: 0 });
      await store.add('2026-11-13', { reads: 1, writes: 0, deletes: 5 });
      expect((await store.read('2026-11-13', false)).used).toEqual({ reads: 4, writes: 2, deletes: 5 });
      // Other counters on the same doc (ingest, ai, email) are left alone.
      const doc = await env.db.doc('a_counters/2026-11-13').get();
      expect(Object.keys(doc.data() ?? {}).sort()).toEqual(['deletes_used', 'reads_used', 'writes_used']);
    });

    it('reads caps from admin_config/settings.quota and ignores bad values', async () => {
      await env.db.doc('admin_config/settings').set({
        tracking_enabled: true,
        quota: { writes_cap: 2_000, reads_cap: -5, deletes_cap: 'lots' },
      });
      const store = new FirestoreQuotaStore(env.db);
      expect((await store.read('2026-11-13', true)).caps).toEqual({
        writes: 2_000,
        reads: undefined,
        deletes: undefined,
      });
    });
  });
});
