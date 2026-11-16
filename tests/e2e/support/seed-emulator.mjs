#!/usr/bin/env node
// Seeds the Firebase Auth + Firestore EMULATORS for the signed-in e2e specs
// and mints one real `__session` cookie per role. Never touches a live
// project: it refuses to run unless both emulator hosts are set, and it only
// ever uses project `demo-syncflow` (a `demo-` id cannot reach real Firebase).
//
// CI (.github/workflows/ci.yml, job e2e-signed-in): emulators started with
//   npx firebase-tools@15.36.0 emulators:start --only firestore,auth --project demo-syncflow
// then this script, then Playwright. The E2E_* values are appended to
// $GITHUB_ENV so the Playwright step (and its `next start`) sees them.
//
// Locally (Java 21 needed for the Firestore emulator):
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//     node tests/e2e/support/seed-emulator.mjs          # prints `export E2E_…=…` lines
//
// Session cookies, the same path a real sign-in takes:
//   1. Admin SDK createUser (fixed uid, email, random password) + setCustomUserClaims({ role })
//      — the `role` claim is what requireAdmin reads (src/server/auth/require-admin.ts)
//   2. Auth emulator REST accounts:signInWithPassword → a fresh ID token carrying the claim
//   3. Admin SDK createSessionCookie(idToken) → the `__session` value (like /api/session)
//   4. verifySessionCookie(cookie, true) here as a check, so a bad cookie fails this step
//
// Exports: E2E_ADMIN_SESSION (owner), E2E_ADMIN_UID, E2E_MODERATOR_SESSION,
// E2E_VIEWER_SESSION, E2E_NOROLE_SESSION, E2E_CHAT_ROOM, E2E_SUBJECT_IP.
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-syncflow';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;

function fail(message) {
  console.error(`seed-emulator: ${message}`);
  process.exit(1);
}

if (!FIRESTORE_HOST || !AUTH_HOST) {
  fail('Set FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST. This script only runs against the emulators.');
}
for (const host of [FIRESTORE_HOST, AUTH_HOST]) {
  if (!/^(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0):\d+$/.test(host)) fail(`Emulator host must be local, got ${host}.`);
}

// --- Fixed test data ----------------------------------------------------------
// uids: 28 chars [A-Za-z0-9], the shape UID_PATTERN and the roles index accept.
const USERS = [
  { key: 'owner', uid: 'e2eOwnerUid00000000000000001', email: 'e2e-owner@example.com', role: 'owner' },
  { key: 'moderator', uid: 'e2eModeratorUid0000000000001', email: 'e2e-moderator@example.com', role: 'moderator' },
  { key: 'viewer', uid: 'e2eViewerUid0000000000000001', email: 'e2e-viewer@example.com', role: 'viewer' },
  { key: 'norole', uid: 'e2eNoRoleUid0000000000000001', email: 'e2e-norole@example.com', role: null },
];
// Room code alphabet: ABCDEFGHJKMNPQRSTUVWXYZ23456789, 8 chars (src/shared/lib/utils.ts).
const ROOM_CODE = 'E2ECHATS';
// Documentation ranges (RFC 5737): never a real visitor, never a private-range warning.
const SUBJECT_IP = '198.51.100.23';
const OTHER_IP = '203.0.113.50';
const BLOCKED_IP = '192.0.2.44';
// Block ids: 20 chars, alphabet without I, L, O, U (block-repository newBlockId).
const BLOCK_ID = 'E2EBXKAAAAAAAAAAAAAA';

const SESSION_COOKIE_TTL_MS = 24 * 60 * 60 * 1000;

// --- 1. Wait for both emulators (first run downloads the jars) ----------------
async function waitFor(host, label, timeoutMs = 180_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fetch(`http://${host}/`);
      return;
    } catch {
      if (Date.now() > until) fail(`${label} emulator at ${host} did not answer within ${timeoutMs / 1000} s.`);
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
}
await Promise.all([waitFor(FIRESTORE_HOST, 'Firestore'), waitFor(AUTH_HOST, 'Auth')]);

// --- 2. Start clean -------------------------------------------------------------
async function clear(url, label) {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) fail(`Could not clear the ${label} emulator: HTTP ${res.status}`);
}
await clear(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, 'Firestore');
await clear(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, 'Auth');

const app = initializeApp({ projectId: PROJECT_ID });
const auth = getAuth(app);
const db = getFirestore(app);

// --- 3. Users with the role claim ---------------------------------------------------
const passwords = new Map();
for (const u of USERS) {
  const password = randomBytes(18).toString('base64url');
  passwords.set(u.key, password);
  await auth.createUser({ uid: u.uid, email: u.email, password, emailVerified: true });
  if (u.role) await auth.setCustomUserClaims(u.uid, { role: u.role });
}

// --- 4. Firestore docs the admin screens and specs read --------------------------------
const now = new Date();
const ts = (d) => Timestamp.fromDate(d);
const hoursAgo = (h) => new Date(now.getTime() - h * 3600_000);
const batch = db.batch();

// admin_config/roles: the admins index (grant-admin.mjs writes the same shape).
batch.set(
  db.collection('admin_config').doc('roles'),
  Object.fromEntries(
    USERS.filter((u) => u.role).map((u) => [u.uid, { email: u.email, role: u.role, granted_by: 'script', granted_at: ts(hoursAgo(48)) }]),
  ),
);

// admin_config/settings (settings-repository parseSettingsDoc fields).
batch.set(db.collection('admin_config').doc('settings'), {
  tracking_enabled: true,
  consent_mode: 'eu_uk',
  ip_retention_days: 30,
  raw_retention_days: 90,
  updated_at: ts(hoursAgo(24)),
  updated_by: USERS[0].uid,
});

// One active IP block (blocks/{id} + the enforcement copy), so Access has a row.
batch.set(db.collection('blocks').doc(BLOCK_ID), {
  type: 'ip',
  value: BLOCKED_IP,
  reason: 'e2e seed',
  created_by: USERS[0].uid,
  created_by_email: USERS[0].email,
  created_at: ts(hoursAgo(3)),
  expires_at: null,
  removed_at: null,
  removed_by: null,
  hits: 0,
  removed: false,
  ends_at: Timestamp.fromDate(new Date('9999-12-31T00:00:00.000Z')),
});
batch.set(db.collection('admin_config').doc('blocklist'), {
  ips: [{ id: BLOCK_ID, value: BLOCKED_IP, expires_at: null }],
  cidrs: [],
  countries: [],
  uids: [],
  devices: [],
  version: 1,
  updated_at: ts(hoursAgo(3)),
});

// A live chat room (src/shared/lib/firebase/chat.ts createRoom shape). firestore.rules
// lets a browser read its messages while expires_at_ts is in the future.
const roomExpires = new Date(now.getTime() + 24 * 3600_000);
batch.set(db.collection('rooms').doc(ROOM_CODE), {
  code: ROOM_CODE,
  name: 'E2E room',
  created_at: hoursAgo(1).toISOString(),
  expires_at: roomExpires.toISOString(),
  ttl_hours: 24,
  created_by: null,
  creator_tz: 'UTC',
  expires_at_ts: ts(roomExpires),
});

// Analytics sessions (a_sessions, event-repository parseSession fields), started
// two hours ago so every range (24h, 7d, 30d) has them. Three hold SUBJECT_IP
// (Danger zone "Find data" and the sessions CSV export have rows).
const started = hoursAgo(2);
const sessions = [
  { ip: SUBJECT_IP, user_id: null, device: 'desktop', vw: 'lg', browser: 'Chrome', os: 'Windows', country: 'DE' },
  { ip: SUBJECT_IP, user_id: null, device: 'mobile', vw: 'sm', browser: 'Safari', os: 'iOS', country: 'DE' },
  { ip: SUBJECT_IP, user_id: USERS[3].uid, device: 'desktop', vw: 'lg', browser: 'Firefox', os: 'Linux', country: 'DE' },
  { ip: OTHER_IP, user_id: null, device: 'tablet', vw: 'md', browser: 'Chrome', os: 'Android', country: 'PK' },
];
const sessionIds = [];
for (const [i, s] of sessions.entries()) {
  const id = randomBytes(16).toString('hex');
  sessionIds.push(id);
  const at = new Date(started.getTime() + i * 60_000);
  const clicks = [
    { target: 'nav-chat', label: 'Chat', x_pct: 40, y_px: 24 },
    { target: 'hero-send', label: 'Send a file', x_pct: 30, y_px: 420 },
  ].map((c, n) => ({
    ts: ts(new Date(at.getTime() + (n + 1) * 5_000)),
    path: '/',
    target: c.target,
    label: c.label,
    x_pct: c.x_pct,
    y_px: c.y_px,
    doc_h: 2400,
    vw_bucket: s.vw,
    rage: false,
    dead: false,
  }));
  batch.set(db.collection('a_sessions').doc(id), {
    started_at: ts(at),
    last_seen_at: ts(new Date(at.getTime() + 60_000)),
    ip: s.ip,
    ip_trunc: s.ip.replace(/\.\d+$/, '.0'),
    ip_hash: null,
    ip_held: true,
    country: s.country,
    region: null,
    city: null,
    lat: null,
    lon: null,
    tz: 'UTC',
    browser: s.browser,
    browser_version: '130',
    os: s.os,
    device: s.device,
    viewport_w: s.vw === 'sm' ? 390 : s.vw === 'md' ? 834 : 1366,
    viewport_h: 800,
    referrer_host: i % 2 ? 'google.com' : null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    entry_path: '/',
    exit_path: '/',
    pageviews: 1,
    engaged_ms: 30_000,
    user_id: s.user_id,
    device_hash: null,
    rolled_up: true,
    sampled: false,
    pages: { [`pv${i}`]: { path: '/', ts: ts(at), engaged_ms: 30_000, scroll_max: 50 } },
    vitals: null,
    clicks,
    click_count: clicks.length,
  });
}

// The matching hourly rollup (model.ts Rollup; map keys are encodeKey'd: "/" → "%2F").
const dim = (n) => ({ sessions: n, views: n, engaged_ms: n * 30_000, bounces: n });
const count = (field) => sessions.reduce((m, s) => ({ ...m, [s[field]]: (m[s[field]] ?? 0) + 1 }), {});
const dimMap = (field) => Object.fromEntries(Object.entries(count(field)).map(([k, n]) => [k, dim(n)]));
const n = sessions.length;
batch.set(db.collection('a_hourly').doc(started.toISOString().slice(0, 13).replace('T', '-')), {
  views: n,
  sessions: n,
  bounces: n,
  engaged_ms: n * 30_000,
  sampled: false,
  path: { '%2F': { views: n, sessions: n, engaged_ms: n * 30_000, bounces: n, entries: n, exits: n, scroll_sum: n * 50 } },
  city: {},
  clicks: { '%2F': { total: n * 2, rage: 0, dead: 0 } },
  country: dimMap('country'),
  region: {},
  device: dimMap('device'),
  browser: dimMap('browser'),
  os: dimMap('os'),
  referrer: { '(none)': dim(2), 'google%2Ecom': dim(2) },
  utm_source: {},
  utm_medium: {},
  utm_campaign: {},
});

await batch.commit();

// --- 5. Session cookies --------------------------------------------------------------
async function idTokenFor(email, password) {
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=e2e-emulator-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.idToken !== 'string') fail(`Sign-in for ${email} failed: HTTP ${res.status} ${JSON.stringify(body.error ?? body)}`);
  return body.idToken;
}

const cookies = {};
for (const u of USERS) {
  const idToken = await idTokenFor(u.email, passwords.get(u.key));
  const cookie = await auth.createSessionCookie(idToken, { expiresIn: SESSION_COOKIE_TTL_MS });
  const decoded = await auth.verifySessionCookie(cookie, true);
  if (decoded.uid !== u.uid || (decoded.role ?? null) !== u.role) {
    fail(`Session cookie for ${u.email} has uid ${decoded.uid} role ${decoded.role ?? 'none'}; expected ${u.uid} ${u.role ?? 'none'}.`);
  }
  cookies[u.key] = cookie;
}

// --- 6. Hand the values to the next steps ---------------------------------------------------
const vars = {
  E2E_ADMIN_SESSION: cookies.owner,
  E2E_ADMIN_UID: USERS[0].uid,
  E2E_MODERATOR_SESSION: cookies.moderator,
  E2E_VIEWER_SESSION: cookies.viewer,
  E2E_NOROLE_SESSION: cookies.norole,
  E2E_CHAT_ROOM: ROOM_CODE,
  E2E_SUBJECT_IP: SUBJECT_IP,
};
for (const [k, v] of Object.entries(vars)) {
  if (!/^[\w.:-]+$/.test(v)) fail(`${k} has unexpected characters; refusing to write it.`);
}

const lines = Object.entries(vars).map(([k, v]) => `${k}=${v}`);
if (process.env.GITHUB_ENV) {
  appendFileSync(process.env.GITHUB_ENV, `${lines.join('\n')}\n`);
  console.log(`seed-emulator: wrote ${lines.length} E2E_* vars to $GITHUB_ENV`);
} else {
  for (const line of lines) console.log(`export ${line}`);
}
console.log(
  `seed-emulator: ${USERS.length} users, ${sessions.length} sessions (${sessionIds.length} ids), room ${ROOM_CODE}, block ${BLOCKED_IP}, project ${PROJECT_ID}`,
);
process.exit(0);
