import { Timestamp } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { QuotaDecision, QuotaKind, QuotaMeter } from '@/server/quota/quota-guard';
import { QuotaExceededError } from '@/server/quota/quota-guard';
import { FirestoreRoomHistoryRepository } from '@/server/repositories/firestore/room-history-repository';
import { FirestoreRoomRepository } from '@/server/repositories/firestore/room-repository';
import { RoomService } from '@/server/services/room-service';
import { AuditService } from '@/server/services/audit-service';
import { MemoryAuditRepository } from '../../support/memory-audit-repository';
import { clearEmulatorFirestore, emulatorAdminDb, hasFirestoreEmulator } from '../../support/firestore-emulator';

// Rooms + users screens on the Firestore emulator: what each new call costs
// (QuotaGuard counts), retention batches, and that nothing reads or stores
// message text. Skips without the emulator (no Java locally); CI runs it.

class RecordingMeter implements QuotaMeter {
  recorded: { kind: QuotaKind; count: number }[] = [];
  decision: QuotaDecision = 'ok';
  stopDeletes = false;
  record(kind: QuotaKind, count = 1) {
    this.recorded.push({ kind, count });
  }
  async canWrite() {
    return this.decision;
  }
  async assertCan(kind: QuotaKind) {
    if (this.decision === 'stop' || (kind === 'deletes' && this.stopDeletes)) throw new QuotaExceededError(kind, 'cap');
    return this.decision;
  }
  noteError() {
    return false;
  }
  total(kind: QuotaKind) {
    return this.recorded.filter((r) => r.kind === kind).reduce((n, r) => n + r.count, 0);
  }
}

const SECRET = 'TOP-SECRET-TEXT';
const NOW = new Date();

describe.skipIf(!hasFirestoreEmulator)('Firestore emulator: rooms and users screens', { timeout: 60_000 }, () => {
  let env: ReturnType<typeof emulatorAdminDb>;
  let meter: RecordingMeter;

  beforeAll(() => {
    env = emulatorAdminDb('rooms-users-screens-test');
  });

  afterAll(async () => {
    await env?.close();
  });

  beforeEach(async () => {
    await clearEmulatorFirestore();
    meter = new RecordingMeter();
  });

  it('peak_online: 1 read per check, 1 write only when higher', async () => {
    const repo = new FirestoreRoomHistoryRepository(env.db, meter);
    await repo.recordOpened({ code: 'PPPPPPP1', name: null, createdAt: NOW, expiresAt: NOW, ttlHours: 1, createdBy: null });
    meter.recorded = [];
    expect(await repo.notePeakOnline('PPPPPPP1', 2)).toBe(true);
    expect(await repo.notePeakOnline('PPPPPPP1', 1)).toBe(false);
    expect(meter.total('reads')).toBe(2);
    expect(meter.total('writes')).toBe(1);
    meter.decision = 'stop';
    expect(await repo.notePeakOnline('PPPPPPP1', 9)).toBe(false);
    expect((await env.db.doc('a_rooms/PPPPPPP1').get()).get('peak_online')).toBe(2);
  });

  it('retention: deletes in one batch, counts reads and deletes, stops at the delete budget', async () => {
    const batch = env.db.batch();
    const old = new Date(NOW.getTime() - 400 * 86_400_000);
    for (let i = 0; i < 30; i++) {
      batch.set(env.db.doc(`a_rooms/OLD${String(i).padStart(5, '0')}`), { created_at: Timestamp.fromDate(old), name: null });
    }
    batch.set(env.db.doc('a_rooms/NEWROOM1'), { created_at: Timestamp.fromDate(NOW), name: null });
    await batch.commit();

    const repo = new FirestoreRoomHistoryRepository(env.db, meter);
    const cutoff = new Date(NOW.getTime() - 365 * 86_400_000);
    expect(await repo.deleteCreatedBefore(cutoff, 20)).toBe(20);
    expect(meter.total('reads')).toBe(20);
    expect(meter.total('deletes')).toBe(20);
    meter.stopDeletes = true;
    await expect(repo.deleteCreatedBefore(cutoff, 20)).rejects.toBeInstanceOf(QuotaExceededError);
    meter.stopDeletes = false;
    expect(await repo.deleteCreatedBefore(cutoff, 500)).toBe(10);
    expect((await env.db.collection('a_rooms').get()).docs.map((d) => d.id)).toEqual(['NEWROOM1']);
  });

  it('admin close on real Firestore: history doc has counts and peak, never text; audit before has counts', async () => {
    const code = 'CLOSEAA1';
    await env.db.doc(`rooms/${code}`).set({
      code,
      name: 'Team',
      created_at: NOW.toISOString(),
      expires_at: new Date(NOW.getTime() + 3_600_000).toISOString(),
      ttl_hours: 1,
      created_by: null,
      creator_tz: 'UTC',
    });
    await env.db.doc(`rooms/${code}/messages/m1`).set({ kind: 'chat', content: SECRET, created_at: NOW.toISOString() });
    await env.db.doc(`rooms/${code}/messages/m2`).set({ kind: 'system', content: 'joined', created_at: NOW.toISOString() });
    await env.db.doc(`rooms/${code}/presence/d1`).set({ device_id: 'd1', name: 'x', last_seen: NOW.toISOString() });

    const rooms = new FirestoreRoomRepository(env.db, meter, async (c, db) => {
      // No R2 on the emulator: delete the docs only, like the shared helper's second step.
      await db.recursiveDelete(db.collection('rooms').doc(c));
      return { objects: 0, bytes: 0, docs: 4 };
    });
    const audit = new MemoryAuditRepository();
    const service = new RoomService({
      reader: rooms,
      closer: rooms,
      history: new FirestoreRoomHistoryRepository(env.db, meter),
      audit: new AuditService(audit),
    });
    const owner = { uid: 'uidOwnerAAAAAAAAAAAAAAAAAAAA', email: 'o@example.com', role: 'owner' as const, authTime: 1 };
    expect((await service.closeRoom(owner, code, { reason: 'test' })).ok).toBe(true);

    expect((await env.db.doc(`rooms/${code}`).get()).exists).toBe(false);
    const history = (await env.db.doc(`a_rooms/${code}`).get()).data();
    expect(history).toMatchObject({ closed_by: owner.uid, message_count: 1, voice_count: 0, peak_online: 1 });
    expect(JSON.stringify(history)).not.toContain(SECRET);
    const [row] = (await audit.list({ limit: 5 })).entries;
    expect(row.before).toMatchObject({ messageCount: 1, onlineCount: 1 });
    expect(JSON.stringify(row)).not.toContain(SECRET);
  });

  it('list row counts cost aggregates only: messageCount = 2 reads, onlineCount = 1', async () => {
    const code = 'COUNTAA1';
    await env.db.doc(`rooms/${code}/messages/m1`).set({ kind: 'chat', content: SECRET });
    const rooms = new FirestoreRoomRepository(env.db, meter);
    expect(await rooms.messageCount(code)).toBe(1);
    expect(meter.total('reads')).toBe(2);
    expect(await rooms.onlineCount(code, new Date(NOW.getTime() - 180_000))).toBe(0);
    expect(meter.total('reads')).toBe(3);
  });
});
