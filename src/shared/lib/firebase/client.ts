import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, sendSignInLinkToEmail, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getBaseUrl } from '@/shared/lib/utils';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

export function clientApp(): FirebaseApp {
  if (!app) {
    app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  }
  return app;
}

export function clientAuth(): Auth {
  if (!auth) auth = getAuth(clientApp());
  return auth;
}

export function clientDb(): Firestore {
  if (!db) db = getFirestore(clientApp());
  return db;
}

// ---------- magic-link sign-in helpers ----------

export const STORED_EMAIL_KEY = 'syncflow.emailForSignIn';
export const STORED_NEXT_KEY = 'syncflow.nextAfterSignIn';

// Kept here so existing imports keep working.
export { safeNextPath } from '@/shared/lib/safe-next';

/** Email a sign-in link that comes back to /auth/callback (carrying `next`). */
export async function sendMagicLink(email: string, next: string | null): Promise<void> {
  const callback = new URL('/auth/callback', getBaseUrl());
  if (next) callback.searchParams.set('next', next);
  await sendSignInLinkToEmail(clientAuth(), email, {
    url: callback.toString(),
    handleCodeInApp: true,
  });
  window.localStorage.setItem(STORED_EMAIL_KEY, email);
  // Backup for when the link opens without its query (some mail apps strip it).
  if (next) window.localStorage.setItem(STORED_NEXT_KEY, next);
  else window.localStorage.removeItem(STORED_NEXT_KEY);
}

/** Plain-language message for a Firebase auth error (never the raw "Firebase: Error (auth/…)"). */
export function authErrorMessage(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : '';
  switch (code) {
    case 'auth/invalid-email':
    case 'auth/missing-email':
      return 'That email address doesn’t look right. Check it and try again.';
    case 'auth/invalid-action-code':
      return 'This sign-in link is invalid or was already used.';
    case 'auth/expired-action-code':
      return 'This sign-in link has expired.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/too-many-requests':
    case 'auth/quota-exceeded':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/unauthorized-continue-uri':
    case 'auth/invalid-continue-uri':
    case 'auth/missing-continue-uri':
    case 'auth/unauthorized-domain':
    case 'auth/operation-not-allowed':
    case 'auth/invalid-api-key':
    case 'auth/configuration-not-found':
      return 'Email sign-in isn’t set up correctly on this site. Please try again later.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

/** Codes that mean "this link can't be used — request a new one". */
export function isDeadLinkError(err: unknown): boolean {
  const code =
    typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : '';
  return code === 'auth/invalid-action-code' || code === 'auth/expired-action-code';
}
