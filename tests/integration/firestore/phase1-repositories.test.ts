import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { QuotaDecision, QuotaKind, QuotaMeter } from '@/server/quota/quota-guard';
import { FirestoreCronRunRepository } from '@/server/repositories/firestore/cron-run-repository';
import { FirestoreFileRepository } from '@/server/repositories/firestore/file-repository';
import { chatId, testFileIds } from '../../support/file-ids';
import { FirestoreRoomHistoryRepository } from '@/server/repositories/firestore/room-history-repository';
import { FirestoreRoomRepository } from '@/server/repositories/firestore/room-repository';
import { FirebaseUserRepository } from '@/server/repositories/firestore/user-repository';
import { runFileRepositoryContract, FILE_SEED, ROOM_A, SECRET } from '../../unit/server/repositories/file-repository.contract';
import { runCronRunContract, runRoomHistoryContract } from '../../unit/server/repositories/history-and-cron.contract';
import { runRoomRepositoryContract } from '../../unit/server/repositories/room-repository.contract';
import { runUserRepositoryContract } from '../../unit/server/repositories/user-repository.contract';
import {
  EMULATOR_PROJECT_ID,
  authEmulatorHost,
  clearEmulatorFirestore,
  emulatorAdminDb,
  hasFirestoreEmulator,
} from '../../support/firestore-emulator';

/** Records what a repository reports; `decision` drives canWrite/assertCan. */
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

describe.skipIf(!hasFirestoreEmulator)('Firestore emulator: phase 1 repositories', { timeout: 30_000 }, () => {
  let env: ReturnType<typeof emulatorAdminDb>;

  beforeAll(() => {
    env = emulatorAdminDb('phase1-repositories-test');
  });

  afterAll(async () => {
    await env?.close();
  });

  runFileRepositoryContract('Firestore (emulator)', async (seed) => {
    await clearEmulatorFirestore();
    const batch = env.db.batch();
    for (const s of seed.shares) batch.set(env.db.collection('files').doc(s.token), s.doc);
    for (const m of seed.messages) batch.set(env.db.doc(`rooms/${m.code}/messages/${m.id}`), m.doc);
    await batch.commit();
    return new FirestoreFileRepository(env.db, new RecordingMeter(), testFileIds);
  });

  runRoomRepositoryContract('Firestore (emulator)', async (seed) => {
    await clearEmulatorFirestore();
    const batch = env.db.batch();
    for (const r of seed) {
      batch.set(env.db.collection('rooms').doc(r.code), r.doc);
      for (const m of r.messages) batch.set(env.db.doc(`rooms/${r.code}/messages/${m.id}`), m.doc);
      for (const p of r.presence) {
        batch.set(env.db.doc(`rooms/${r.code}/presence/${p.id}`), { device_id: p.id, name: 'x', last_seen: p.lastSeen });
      }
    }
    await batch.commit();
    // No R2 on the emulator: delete the docs only.
    return new FirestoreRoomRepository(env.db, new RecordingMeter(), async (code, db) => {
      await db.recursiveDelete(db.collection('rooms').doc(code));
      return { objects: 0, bytes: 0, docs: null };
    });
  });

  runRoomHistoryContract('Firestore (emulator)', async () => {
    await clearEmulatorFirestore();
    return new FirestoreRoomHistoryRepository(env.db, new RecordingMeter());
  });

  runCronRunContract('Firestore (emulator)', async () => {
    await clearEmulatorFirestore();
    return new FirestoreCronRunRepository(env.db, new RecordingMeter());
  });

  describe('D-4 and quota on real Firestore', () => {
    let meter: RecordingMeter;

    beforeEach(async () => {
      await clearEmulatorFirestore();
      meter = new RecordingMeter();
    });

    it('marking a chat attachment removed leaves the message text untouched', async () => {
      const m1 = FILE_SEED.messages[0];
      await env.db.doc(`rooms/${m1.code}/messages/${m1.id}`).set(m1.doc);
      const repo = new FirestoreFileRepository(env.db, meter, testFileIds);
      expect(await repo.removeRecord(chatId(ROOM_A, 'm1', 0), new Date())).toBe(true);
      const stored = (await env.db.doc(`rooms/${m1.code}/messages/${m1.id}`).get()).data();
      expect(stored?.content).toBe(SECRET);
      expect(stored?.attachments[0].removed_at).toEqual(expect.any(String));
      expect(stored?.attachments[1].removed_at).toBeUndefined();
      expect(meter.total('writes')).toBe(1);
    });

    it('room history skips its write when QuotaGuard says stop, and counts the ones it makes', async () => {
      const repo = new FirestoreRoomHistoryRepository(env.db, meter);
      const room = { code: 'QQQQQQQ1', name: null, createdAt: new Date(), expiresAt: new Date(), ttlHours: 1, createdBy: null };
      meter.decision = 'stop';
      expect(await repo.recordOpened(room)).toBe(false);
      expect((await env.db.collection('a_rooms').doc('QQQQQQQ1').get()).exists).toBe(false);
      meter.decision = 'ok';
      expect(await repo.recordOpened(room)).toBe(true);
      expect(meter.total('writes')).toBe(1);
    });

    it('cron runs: 1 write per append, rows read per list', async () => {
      const repo = new FirestoreCronRunRepository(env.db, meter);
      const now = new Date();
      await repo.append({ job: 'cleanup', startedAt: now, finishedAt: now, status: 'ok', result: {}, errorId: null });
      await repo.listRecent('cleanup', 14);
      expect(meter.total('writes')).toBe(1);
      expect(meter.total('reads')).toBe(1);
    });
  });
});

describe.skipIf(!hasFirestoreEmulator || !authEmulatorHost)('Auth emulator: user repository', { timeout: 30_000 }, () => {
  let env: ReturnType<typeof emulatorAdminDb>;
  let authApp: App;

  beforeAll(() => {
    env = emulatorAdminDb('phase1-users-test');
    authApp = initializeApp({ projectId: EMULATOR_PROJECT_ID }, 'phase1-users-auth');
  });

  afterAll(async () => {
    await env?.close();
    if (authApp) await deleteApp(authApp);
  });

  runUserRepositoryContract('Firebase Auth (emulator)', async (seed) => {
    const res = await fetch(`http://${authEmulatorHost}/emulator/v1/projects/${EMULATOR_PROJECT_ID}/accounts`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Could not clear the Auth emulator: ${res.status}`);
    await clearEmulatorFirestore();
    const auth = getAuth(authApp);
    for (const u of seed) await auth.createUser({ uid: u.uid, email: u.email });
    return new FirebaseUserRepository(auth, env.db, new RecordingMeter());
  });
});
