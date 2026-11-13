import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Firestore + Auth emulator helpers for integration tests.
 *
 * `npm run test:integration:emulator` starts both emulators through
 * firebase-tools, which sets FIRESTORE_EMULATOR_HOST and
 * FIREBASE_AUTH_EMULATOR_HOST. Plain `npm run test:integration` (no Java on
 * the machine) leaves them unset and the emulator suites skip. CI sets
 * REQUIRE_FIRESTORE_EMULATOR=1 so a skipped emulator suite fails the job
 * instead of passing silently.
 *
 * The project id starts with `demo-`, so the emulator never reaches a real
 * Firebase project, and tests never spend the shared production quota.
 */
export const EMULATOR_PROJECT_ID = 'demo-syncflow';
export const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? '';
export const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '';
export const hasFirestoreEmulator = firestoreEmulatorHost !== '';

if (process.env.REQUIRE_FIRESTORE_EMULATOR === '1' && !hasFirestoreEmulator) {
  throw new Error('REQUIRE_FIRESTORE_EMULATOR=1 but FIRESTORE_EMULATOR_HOST is not set. Run npm run test:integration:emulator.');
}

/** An Admin SDK Firestore on the emulator. No credentials needed. */
export function emulatorAdminDb(appName: string): { db: Firestore; close: () => Promise<void> } {
  const app = initializeApp({ projectId: EMULATOR_PROJECT_ID }, appName);
  return { db: getFirestore(app), close: () => deleteApp(app) };
}

/** Deletes every document in the emulator database. */
export async function clearEmulatorFirestore(): Promise<void> {
  const res = await fetch(
    `http://${firestoreEmulatorHost}/emulator/v1/projects/${EMULATOR_PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error(`Could not clear the Firestore emulator: ${res.status}`);
}
