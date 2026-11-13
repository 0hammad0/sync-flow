import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  type Firestore,
} from 'firebase/firestore/lite';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';

import { FirestoreAuditRepository } from '@/server/repositories/firestore/audit-repository';
import type { AuditRepository } from '@/server/repositories/interfaces';
import {
  EMULATOR_PROJECT_ID,
  authEmulatorHost,
  firestoreEmulatorHost,
  hasFirestoreEmulator,
} from '../../support/firestore-emulator';

describe('AuditRepository is append only', () => {
  // appendOnce uses Firestore create(): it fails on an existing id, so it can
  // never change a stored row.
  it('has exactly append, appendOnce and list (type test: tsc fails if a method is added)', () => {
    expectTypeOf<keyof AuditRepository>().toEqualTypeOf<'append' | 'appendOnce' | 'list'>();
  });

  it('FirestoreAuditRepository has no other public method at runtime', () => {
    const methods = Object.getOwnPropertyNames(FirestoreAuditRepository.prototype).filter((m) => m !== 'constructor');
    expect(methods.sort()).toEqual(['append', 'appendOnce', 'list']);
  });
});

/** Every server-only collection, plus an unknown a_* name to prove the default deny covers new ones. */
const CLOSED_COLLECTIONS = [
  'admin_audit',
  'admin_cron_runs',
  'admin_config',
  'blocks',
  'a_sessions',
  'a_hourly',
  'a_daily',
  'a_counters',
  'a_not_yet_created',
];

function hostAndPort(value: string): [string, number] {
  const [host, port] = value.split(':');
  return [host, Number(port)];
}

describe.skipIf(!hasFirestoreEmulator)('firestore.rules on the emulator: admin data is closed to clients', { timeout: 30_000 }, () => {
  const apps: FirebaseApp[] = [];
  const clients: { name: string; db: Firestore }[] = [];

  beforeAll(async () => {
    const [host, port] = hostAndPort(firestoreEmulatorHost);

    const anonApp = initializeApp({ projectId: EMULATOR_PROJECT_ID, apiKey: 'demo-key' }, 'rules-anon');
    const anonDb = getFirestore(anonApp);
    connectFirestoreEmulator(anonDb, host, port);
    apps.push(anonApp);
    clients.push({ name: 'signed out', db: anonDb });

    if (!authEmulatorHost) throw new Error('FIREBASE_AUTH_EMULATOR_HOST is not set; start the auth emulator too.');
    const userApp = initializeApp({ projectId: EMULATOR_PROJECT_ID, apiKey: 'demo-key' }, 'rules-user');
    const auth = getAuth(userApp);
    connectAuthEmulator(auth, `http://${authEmulatorHost}`, { disableWarnings: true });
    const cred = await signInAnonymously(auth);
    expect(cred.user.uid).toBeTruthy();
    const userDb = getFirestore(userApp);
    connectFirestoreEmulator(userDb, host, port);
    apps.push(userApp);
    clients.push({ name: 'signed in', db: userDb });
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => deleteApp(app)));
  });

  it('loads the repo rules (control: a room get is allowed)', async () => {
    for (const { db } of clients) {
      const snap = await getDoc(doc(db, 'rooms', 'NOROOM00'));
      expect(snap.exists()).toBe(false);
    }
  });

  for (const name of CLOSED_COLLECTIONS) {
    it(`denies get, list, write, delete and subcollections on ${name}`, async () => {
      for (const client of clients) {
        const denied = { code: 'permission-denied' };
        const probe = doc(client.db, name, 'probe');
        await expect(getDoc(probe), `${client.name} get`).rejects.toMatchObject(denied);
        await expect(getDocs(collection(client.db, name)), `${client.name} list`).rejects.toMatchObject(denied);
        await expect(setDoc(probe, { x: 1 }), `${client.name} set`).rejects.toMatchObject(denied);
        await expect(deleteDoc(probe), `${client.name} delete`).rejects.toMatchObject(denied);
        await expect(getDoc(doc(client.db, name, 'probe', 'sub', 'x')), `${client.name} sub get`).rejects.toMatchObject(denied);
      }
    });
  }

  it('denies the fixed admin_config docs', async () => {
    for (const { db } of clients) {
      for (const id of ['settings', 'blocklist', 'roles']) {
        await expect(getDoc(doc(db, 'admin_config', id))).rejects.toMatchObject({ code: 'permission-denied' });
      }
    }
  });
});
