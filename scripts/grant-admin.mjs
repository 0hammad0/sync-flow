// Grant, change or remove a user's admin role (the `role` custom claim), and
// record it in the admin audit log. Run locally with the Firebase Admin
// credentials from .env.local (the same FIREBASE_* vars the app uses).
//
// Usage:
//   node scripts/grant-admin.mjs <email> <role> [--reason "text"] [--yes]
//   node scripts/grant-admin.mjs --email a@b.com --role moderator
//   role: owner | moderator | viewer | none   (none removes the claim)
//
// Emulators: set BOTH FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST
// and no live credentials are needed.
//
// Spec: docs/admin/03-features/01-auth.md ("Grant-admin script flow").
// Writes, in this order (11-audit-log.md "Write rules", non-Firestore change first):
//   1. setCustomUserClaims(uid, { ...old, role })   (role removed for `none`)
//   2. revokeRefreshTokens(uid) when access goes down, because the old role
//      stays in their session cookie until it is revoked (01-auth.md edge case 2)
//   3. one batch: admin_audit `role.set` row (actor_email 'script') + admin_config/roles
//   If step 3 fails, the old claims are restored and the script exits 1.
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

// Keep in sync with src/server/auth/permissions.ts ADMIN_ROLES.
const ROLES = ['owner', 'moderator', 'viewer'];
const RANK = { none: 0, viewer: 1, moderator: 2, owner: 3 };
const AUDIT_COLLECTION = 'admin_audit';
const ROLES_DOC = ['admin_config', 'roles'];

const USAGE = `Usage: node scripts/grant-admin.mjs <email> <role> [--reason "text"] [--yes]
  role: ${[...ROLES, 'none'].join(' | ')}  (none removes admin access)`;

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

// --- 1. Arguments (checked before any credentials or network) ---------------
let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      email: { type: 'string' },
      role: { type: 'string' },
      reason: { type: 'string' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (e) {
  fail(`${e.message}\n${USAGE}`, 2);
}
const { values, positionals } = parsed;
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const email = (values.email ?? positionals[0] ?? '').trim().toLowerCase();
const newRole = (values.role ?? positionals[1] ?? '').trim();
const reason = (values.reason ?? '').trim();

if (!email || !newRole || positionals.length > 2) fail(USAGE, 2);
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`Not an email address: ${email}`, 2);
if (newRole !== 'none' && !ROLES.includes(newRole)) {
  fail(`Unknown role "${newRole}". Use one of: ${[...ROLES, 'none'].join(', ')}.`, 2);
}

// --- 2. Credentials, same vars as src/shared/lib/firebase/admin.ts ----------
const envFile = new URL('../.env.local', import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}

const authEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST;
if (Boolean(authEmulator) !== Boolean(firestoreEmulator)) {
  fail('Set both FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST, or neither. Refusing to mix emulator and live.');
}
const onEmulator = Boolean(authEmulator);

const projectId = process.env.FIREBASE_PROJECT_ID || (onEmulator ? 'demo-syncflow' : undefined);
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

let app;
if (onEmulator) {
  app = initializeApp({ projectId });
} else {
  if (!projectId || !clientEmail || !privateKey) {
    fail('Missing Firebase Admin credentials. Check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in .env.local');
  }
  app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}
const auth = getAuth(app);
const db = getFirestore(app);

// --- 3. Look up the user -----------------------------------------------------
let user;
try {
  user = await auth.getUserByEmail(email);
} catch (e) {
  if (e?.code === 'auth/user-not-found') fail('No user with that email. They must sign in once first.');
  throw e;
}

const oldClaims = { ...(user.customClaims ?? {}) };
const oldRole = ROLES.includes(oldClaims.role) ? oldClaims.role : null;
const toRole = newRole === 'none' ? null : newRole;

console.log(`Project: ${projectId}${onEmulator ? ' (emulator)' : ' (LIVE)'}`);
console.log(`User:    ${user.email} (uid ${user.uid})`);
console.log(`Claims:  ${JSON.stringify(oldClaims)}`);

if (oldRole === toRole) {
  console.log(`Nothing to change: role is already ${oldRole ?? 'none'}.`);
  process.exit(0);
}

const lowersAccess = RANK[newRole] < RANK[oldRole ?? 'none'];

// --- 4. Confirm --------------------------------------------------------------
if (!values.yes) {
  if (!process.stdin.isTTY) fail('Not a terminal: pass --yes to confirm.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const extra = lowersAccess ? ' This signs them out on every device.' : '';
  const answer = await rl.question(`Set role=${newRole} for ${user.email}?${extra} (y/N) `);
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) fail('Cancelled. Nothing changed.', 0);
}

// --- 5. Write ----------------------------------------------------------------
const nextClaims = { ...oldClaims };
if (toRole) nextClaims.role = toRole;
else delete nextClaims.role;

await auth.setCustomUserClaims(user.uid, nextClaims);
if (lowersAccess) await auth.revokeRefreshTokens(user.uid);

try {
  const batch = db.batch();
  batch.create(db.collection(AUDIT_COLLECTION).doc(), {
    at: FieldValue.serverTimestamp(),
    actor_uid: null,
    actor_email: 'script',
    actor_role: null,
    action: 'role.set',
    target_type: 'user',
    target_id: user.uid,
    before: { role: oldRole },
    after: { role: toRole, revoked_sessions: lowersAccess },
    reason,
    ip: null,
    user_agent: null,
  });
  batch.set(
    db.collection(ROLES_DOC[0]).doc(ROLES_DOC[1]),
    {
      [user.uid]: toRole
        ? { email: user.email ?? email, role: toRole, granted_by: 'script', granted_at: FieldValue.serverTimestamp() }
        : FieldValue.delete(),
    },
    { merge: true },
  );
  await batch.commit();
} catch (e) {
  console.error('Audit write failed. Restoring the old claims.', e);
  await auth.setCustomUserClaims(user.uid, Object.keys(oldClaims).length ? oldClaims : null);
  fail(lowersAccess ? 'Claims restored. Their sessions stay revoked: they must sign in again.' : 'Claims restored. Nothing changed.');
}

console.log(`Done: role ${oldRole ?? 'none'} → ${newRole}.`);
if (lowersAccess) console.log('Their sessions were revoked, so they are signed out everywhere.');
console.log(toRole ? 'Sign in again to get the new role.' : 'Admin access removed.');
process.exit(0);
