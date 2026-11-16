import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Timestamp } from 'firebase-admin/firestore';
import type { QuotaDecision, QuotaKind, QuotaMeter } from '@/server/quota/quota-guard';
import type { NewAuditEntry } from '@/server/repositories/interfaces';
import { FirestoreSettingsRepository } from '@/server/repositories/firestore/settings-repository';
import { FirestoreSubjectDataRepository } from '@/server/repositories/firestore/subject-data-repository';
import { clearEmulatorFirestore, emulatorAdminDb, hasFirestoreEmulator } from '../../support/firestore-emulator';

/** Records what the repositories report, never blocks. */
class RecordingMeter implements QuotaMeter {
  recorded: { kind: QuotaKind; count: number }[] = [];
  record(kind: QuotaKind, count = 1) {
    this.recorded.push({ kind, count });
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
  total(kind: QuotaKind) {
    return this.recorded.filter((r) => r.kind === kind).reduce((sum, r) => sum + r.count, 0);
  }
}

const entry: NewAuditEntry = {
  actorUid: 'uidOwnerAAAAAAAAAAAAAAAAAAAA',
  actorEmail: 'owner@example.com',
  actorRole: 'owner',
  action: 'settings.update',
  targetType: 'settings',
  targetId: 'admin_config/settings',
  before: { tracking_enabled: true },
  after: { tracking_enabled: false },
  reason: null,
  ip: null,
  userAgent: null,
};
const values = { trackingEnabled: false, consentMode: 'all' as const, ipRetentionDays: 7, rawRetentionDays: 30 };

describe.skipIf(!hasFirestoreEmulator)('Firestore emulator: settings + subject delete', { timeout: 30_000 }, () => {
  let env: ReturnType<typeof emulatorAdminDb>;
  let meter: RecordingMeter;

  beforeAll(() => {
    env = emulatorAdminDb('settings-repository-test');
  });

  afterAll(async () => {
    await env?.close();
  });

  beforeEach(async () => {
    await clearEmulatorFirestore();
    meter = new RecordingMeter();
  });

  describe('FirestoreSettingsRepository', () => {
    it('reads defaults for a missing doc and the stored fields otherwise (1 read each)', async () => {
      const repo = new FirestoreSettingsRepository(env.db, meter);
      expect(await repo.read()).toMatchObject({ exists: false, values: { trackingEnabled: false, consentMode: 'eu_uk' } });
      const at = Timestamp.fromMillis(1_763_000_000_000);
      await env.db.doc('admin_config/settings').set({ tracking_enabled: true, consent_mode: 'none', updated_at: at, updated_by: 'x' });
      expect(await repo.read()).toMatchObject({
        exists: true,
        values: { trackingEnabled: true, consentMode: 'none', ipRetentionDays: 30, rawRetentionDays: 90 },
        updatedAt: at.toDate(),
        updatedBy: 'x',
      });
      expect(meter.total('reads')).toBe(2);
    });

    it('saves the four fields with merge (quota kept) and the audit row in one transaction', async () => {
      await env.db.doc('admin_config/settings').set({ tracking_enabled: true, quota: { writes_cap: 1000 } });
      const repo = new FirestoreSettingsRepository(env.db, meter);
      const now = new Date('2026-11-16T10:00:00.000Z');
      expect(await repo.write({ values, expectedUpdatedAt: null, actorUid: 'uidOwner', now, audit: () => entry })).toBe('saved');
      const doc = (await env.db.doc('admin_config/settings').get()).data();
      expect(doc).toMatchObject({
        tracking_enabled: false,
        consent_mode: 'all',
        ip_retention_days: 7,
        raw_retention_days: 30,
        updated_by: 'uidOwner',
        quota: { writes_cap: 1000 },
      });
      expect((doc?.updated_at as Timestamp).toMillis()).toBe(now.getTime());
      const audit = await env.db.collection('admin_audit').get();
      expect(audit.docs.map((d) => d.data().action)).toEqual(['settings.update']);
      expect(meter.total('writes')).toBe(2);
    });

    it('refuses a stale updated_at and writes nothing; null audit = unchanged, nothing written', async () => {
      const repo = new FirestoreSettingsRepository(env.db, meter);
      await env.db.doc('admin_config/settings').set({ tracking_enabled: true, updated_at: Timestamp.fromMillis(5_000) });
      const now = new Date();
      expect(await repo.write({ values, expectedUpdatedAt: 4_000, actorUid: 'u', now, audit: () => entry })).toBe('conflict');
      expect(await repo.write({ values, expectedUpdatedAt: 5_000, actorUid: 'u', now, audit: () => null })).toBe('unchanged');
      expect((await env.db.doc('admin_config/settings').get()).data()?.tracking_enabled).toBe(true);
      expect((await env.db.collection('admin_audit').get()).size).toBe(0);
      expect(meter.total('writes')).toBe(0);
    });
  });

  describe('FirestoreSubjectDataRepository', () => {
    beforeEach(async () => {
      const batch = env.db.batch();
      for (let i = 0; i < 6; i += 1) batch.set(env.db.doc(`a_sessions/ip${i}`), { ip: '203.0.113.9', user_id: null, pages: { p1: { path: '/' } }, clicks: { c1: { n: 1 } } });
      for (let i = 0; i < 3; i += 1) batch.set(env.db.doc(`a_sessions/uid${i}`), { ip: '198.51.100.1', user_id: 'uidVisitorBBBBBBBBBBBBBBBBBB' });
      batch.set(env.db.doc('a_sessions/other'), { ip: '198.51.100.2', user_id: null });
      batch.set(env.db.doc('a_daily/2026-11-15'), { views: 10 });
      await batch.commit();
    });

    it('counts by exact ip or user_id (aggregation: 1 read per 1,000)', async () => {
      const repo = new FirestoreSubjectDataRepository(env.db, meter);
      expect(await repo.countSessions({ kind: 'ip', value: '203.0.113.9' })).toBe(6);
      expect(await repo.countSessions({ kind: 'uid', value: 'uidVisitorBBBBBBBBBBBBBBBBBB' })).toBe(3);
      expect(await repo.countSessions({ kind: 'ip', value: '203.0.113.' })).toBe(0);
      expect(meter.total('reads')).toBe(3);
    });

    it('deletes up to the limit per batch, only the subject’s sessions; rollups stay', async () => {
      const repo = new FirestoreSubjectDataRepository(env.db, meter);
      const subject = { kind: 'ip' as const, value: '203.0.113.9' };
      expect(await repo.deleteSessionsBatch(subject, 4)).toBe(4);
      expect(await repo.deleteSessionsBatch(subject, 4)).toBe(2);
      expect(await repo.deleteSessionsBatch(subject, 4)).toBe(0);
      const left = (await env.db.collection('a_sessions').get()).docs.map((d) => d.id).sort();
      expect(left).toEqual(['other', 'uid0', 'uid1', 'uid2']);
      expect((await env.db.doc('a_daily/2026-11-15').get()).exists).toBe(true);
      expect(meter.total('deletes')).toBe(6);
      expect(meter.total('reads')).toBe(4 + 2 + 1);
    });
  });
});
