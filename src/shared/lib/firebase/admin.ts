import 'server-only';
import { initializeApp, getApps, cert, type App, type AppOptions } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';

let app: App;

/**
 * Project id on the Firebase emulators. The `demo-` prefix means the Admin
 * SDK and the emulators never reach a real Firebase project. Same id as
 * `npm run test:integration:emulator` and scripts/grant-admin.mjs.
 */
export const EMULATOR_PROJECT_ID = 'demo-syncflow';

type AdminEnv = Readonly<Record<string, string | undefined>>;

/**
 * How the Admin app starts.
 *
 * - Emulator (FIRESTORE_EMULATOR_HOST set): no credentials, project
 *   `demo-syncflow`. The Admin SDK sends Firestore and Auth calls to the
 *   emulator hosts by itself. FIREBASE_AUTH_EMULATOR_HOST must be set too, so
 *   a half-configured run can never send Auth calls to a live project.
 * - Otherwise: the service-account cert, all three vars required (unchanged).
 */
export function adminAppOptions(env: AdminEnv = process.env): AppOptions {
  if (env.FIRESTORE_EMULATOR_HOST) {
    if (!env.FIREBASE_AUTH_EMULATOR_HOST) {
      throw new Error(
        'FIRESTORE_EMULATOR_HOST is set but FIREBASE_AUTH_EMULATOR_HOST is not. Set both (emulator) or neither (live).',
      );
    }
    return { projectId: EMULATOR_PROJECT_ID };
  }

  const projectId = env.FIREBASE_PROJECT_ID;
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey = env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Missing Firebase Admin credentials. Check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in .env.local'
    );
  }

  return { credential: cert({ projectId, clientEmail, privateKey }) };
}

function getAdminApp(): App {
  if (getApps().length) {
    return getApps()[0];
  }
  return initializeApp(adminAppOptions());
}

export function adminDb(): Firestore {
  if (!app) app = getAdminApp();
  return getFirestore(app);
}

export function adminAuth(): Auth {
  if (!app) app = getAdminApp();
  return getAuth(app);
}
