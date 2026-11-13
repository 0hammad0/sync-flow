import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { QuotaDecision, QuotaKind, QuotaMeter } from '@/server/quota/quota-guard';
import { FirestoreBlockRepository } from '@/server/repositories/firestore/block-repository';
import type { NewAuditEntry } from '@/server/repositories/interfaces';
import { runBlockRepositoryContract } from '../../unit/server/repositories/block-repository.contract';
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
  total(kind: QuotaKind) {
    return this.recorded.filter((r) => r.kind === kind).reduce((n, r) => n + r.count, 0);
  }
}

describe.skipIf(!hasFirestoreEmulator)('Firestore emulator: blocks', { timeout: 30_000 }, () => {
  let env: ReturnType<typeof emulatorAdminDb>;

  beforeAll(() => {
    env = emulatorAdminDb('block-repository-test');
  });

  afterAll(async () => {
    await env?.close();
  });

  async function auditRows(): Promise<NewAuditEntry[]> {
    const snap = await env.db.collection('admin_audit').get();
    return snap.docs
      .map((d) => d.data())
      .sort((a, b) => (a.action < b.action ? -1 : 1))
      .map((d) => ({
        actorUid: d.actor_uid,
        actorEmail: d.actor_email,
        actorRole: d.actor_role,
        action: d.action,
        targetType: d.target_type,
        targetId: d.target_id,
        before: d.before,
        after: d.after,
        reason: d.reason,
        ip: d.ip,
        userAgent: d.user_agent,
      }));
  }

  runBlockRepositoryContract('Firestore (emulator)', async () => {
    await clearEmulatorFirestore();
    return { repo: new FirestoreBlockRepository(env.db, new RecordingMeter()), auditRows };
  });

  describe('FirestoreBlockRepository quota reporting', () => {
    let meter: RecordingMeter;
    let repo: FirestoreBlockRepository;

    beforeEach(async () => {
      await clearEmulatorFirestore();
      meter = new RecordingMeter();
      repo = new FirestoreBlockRepository(env.db, meter);
    });

    it('reports 2 reads per blocklist load and is never refused at the read cap', async () => {
      meter.decision = 'stop';
      await repo.readBlocklist();
      expect(meter.total('reads')).toBe(2);
    });

    it('reports 1 read + 3 writes per create', async () => {
      const now = new Date();
      await repo.create(
        { type: 'ip', value: '203.0.113.7', reason: 'x y z', createdBy: 'u', createdByEmail: null, expiresAt: null },
        (b) => ({
          actorUid: 'u',
          actorEmail: null,
          actorRole: 'owner',
          action: 'block.create',
          targetType: 'block_ip',
          targetId: b.id,
          before: null,
          after: null,
          reason: null,
          ip: null,
          userAgent: null,
        }),
        now,
      );
      expect(meter.total('reads')).toBe(1);
      expect(meter.total('writes')).toBe(3);
    });
  });
});
