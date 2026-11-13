import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { emptyRollup } from '@/server/analytics/model';
import { encodeKey } from '@/server/firestore/encode-key';
import type { QuotaDecision, QuotaKind, QuotaMeter } from '@/server/quota/quota-guard';
import { FirestoreEventRepository } from '@/server/repositories/firestore/event-repository';
import { runEventRepositoryContract } from '../../unit/server/repositories/event-repository.contract';
import { clearEmulatorFirestore, emulatorAdminDb, hasFirestoreEmulator } from '../../support/firestore-emulator';

/** Records what the repository reports, never blocks. */
class RecordingMeter implements QuotaMeter {
  recorded: { kind: QuotaKind; count: number }[] = [];
  errors: unknown[] = [];
  record(kind: QuotaKind, count = 1) {
    this.recorded.push({ kind, count });
  }
  async canWrite(): Promise<QuotaDecision> {
    return 'ok';
  }
  async assertCan(): Promise<QuotaDecision> {
    return 'ok';
  }
  noteError(error: unknown) {
    this.errors.push(error);
    return false;
  }
  total(kind: QuotaKind) {
    return this.recorded.filter((r) => r.kind === kind).reduce((sum, r) => sum + r.count, 0);
  }
}

describe.skipIf(!hasFirestoreEmulator)('Firestore emulator: analytics data', { timeout: 30_000 }, () => {
  let env: ReturnType<typeof emulatorAdminDb>;

  beforeAll(() => {
    env = emulatorAdminDb('event-repository-test');
  });

  afterAll(async () => {
    await env?.close();
  });

  runEventRepositoryContract('Firestore (emulator)', async () => {
    await clearEmulatorFirestore();
    return new FirestoreEventRepository(env.db, new RecordingMeter());
  });

  describe('FirestoreEventRepository specifics', () => {
    let meter: RecordingMeter;
    let repo: FirestoreEventRepository;
    const t0 = new Date('2026-11-13T10:00:00.000Z');

    beforeEach(async () => {
      await clearEmulatorFirestore();
      meter = new RecordingMeter();
      repo = new FirestoreEventRepository(env.db, meter);
    });

    it('reads the tracking settings doc, with code defaults for missing fields', async () => {
      await env.db.doc('admin_config/settings').set({ tracking_enabled: true, ip_retention_days: 7, quota: { writes_cap: 1 } });
      expect(await repo.readTrackingSettings()).toEqual({ trackingEnabled: true, ipRetentionDays: 7, rawRetentionDays: 90 });
      await env.db.doc('admin_config/settings').set({ tracking_enabled: 'yes' });
      expect((await repo.readTrackingSettings()).trackingEnabled).toBe(false);
    });

    it('reports 1 write per flush, 2 with the hourly rollup, and 1 read per get', async () => {
      const patch = {
        id: 'e'.repeat(32),
        now: t0,
        set: { started_at: t0, rolled_up: false },
        increment: { pageviews: 1, engaged_ms: 0 },
        pages: { p1: { path: '/', ts: t0, engaged_ms: 0 } },
      };
      await repo.writeSession(patch);
      expect(meter.total('writes')).toBe(1);
      await repo.writeSession(patch, { hour: '2026-11-13-10', delta: emptyRollup() });
      expect(meter.total('writes')).toBe(3);
      await repo.getSession(patch.id);
      expect(meter.total('reads')).toBe(1);
    });

    it('stores map keys literally (no dotted-path split) and keeps the doc small', async () => {
      const r = emptyRollup();
      r.sessions = 1;
      r.referrer[encodeKey('news.example.com')] = { sessions: 1, views: 1, engaged_ms: 0, bounces: 1 };
      await repo.writeSession(
        { id: 'f'.repeat(32), now: t0, set: {}, increment: { pageviews: 0, engaged_ms: 0 }, pages: {} },
        { hour: '2026-11-13-10', delta: r },
      );
      const raw = (await env.db.doc('a_hourly/2026-11-13-10').get()).data();
      expect(Object.keys(raw?.referrer ?? {})).toEqual(['news%2Eexample%2Ecom']);
    });

    it('a deleted session is not recreated by a late catch-up rollup', async () => {
      await expect(repo.rollUpSession('0'.repeat(32), { hour: '2026-11-13-10', delta: emptyRollup() })).rejects.toThrow();
      expect((await env.db.doc(`a_sessions/${'0'.repeat(32)}`).get()).exists).toBe(false);
      expect(meter.errors).toHaveLength(1);
    });
  });
});
