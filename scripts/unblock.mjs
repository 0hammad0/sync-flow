#!/usr/bin/env node
// Break-glass unblock (owner lockout). Removes one block from the enforcement
// copy `admin_config/blocklist`, marks its `blocks/{id}` row removed, and
// writes the same `block.remove` audit row the app writes, so nobody has to
// hand-edit Firestore. Run locally with the Firebase Admin credentials from
// .env.local (the same FIREBASE_* vars the app uses).
//
// The app's own way out: an owner can always run Unblock on /admin/access,
// even while blocked (isBlockExempt + unblockSubject). This script is for when
// that is not possible (signed out, no owner session, site down).
//
// Usage:
//   node --env-file=.env.local scripts/unblock.mjs --list
//   node --env-file=.env.local scripts/unblock.mjs <subject> [--reason "text"] [--yes]
//   subject: block id, support ref (K3F9QX-2611131402) or its 6-char prefix,
//            or the blocked value as stored: IP, range (CIDR), country (US),
//            uid, device key, or an email (looked up to its uid)
//
// Without --yes it only prints what it would remove. A range or country that
// covers your IP is not found by the IP: run --list and pass its id.
//
// Emulator: set FIRESTORE_EMULATOR_HOST (and FIREBASE_AUTH_EMULATOR_HOST for
// an email subject) and no live credentials are needed.
//
// Writes, one transaction (same as FirestoreBlockRepository.remove):
//   blocks/{id}            removed_at, removed_by 'script', removed true (when the row exists)
//   admin_config/blocklist entry dropped (expired entries too), version + 1
//   admin_audit            `block.remove` row, actor_email 'script'
// Other server instances apply it within 60 s (blocklist cache age).
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

// Keep in sync with src/server/blocklist/types.ts BLOCKLIST_FIELDS and
// src/server/firestore/collections.ts.
const FIELDS = { ip: 'ips', cidr: 'cidrs', country: 'countries', uid: 'uids', device: 'devices' };
const BLOCKS_COLLECTION = 'blocks';
const AUDIT_COLLECTION = 'admin_audit';
const BLOCKLIST_DOC = ['admin_config', 'blocklist'];
// src/shared/lib/block-values.ts BLOCK_REF_PATTERN
const REF_PATTERN = /^([A-Z0-9]{6})(?:-\d{10})?$/i;

const USAGE = `Usage: node --env-file=.env.local scripts/unblock.mjs --list
       node --env-file=.env.local scripts/unblock.mjs <subject> [--reason "text"] [--yes]
  subject: block id | support ref | IP | range | country | uid | device key | email`;

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
      list: { type: 'boolean' },
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

const subject = (positionals[0] ?? '').trim();
const reason = (values.reason ?? '').trim();
if (values.list ? positionals.length > 0 || values.yes : !subject || positionals.length > 1) fail(USAGE, 2);

// --- 2. Credentials, same vars as src/shared/lib/firebase/admin.ts ----------
const envFile = new URL('../.env.local', import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}

const onEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
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
const db = getFirestore(app);
const blocklistRef = db.collection(BLOCKLIST_DOC[0]).doc(BLOCKLIST_DOC[1]);

console.log(`Project: ${projectId}${onEmulator ? ' (emulator)' : ' (LIVE)'}`);

// --- 3. Read the enforcement copy -------------------------------------------
/** Entries as the app parses them (block-repository parseBlocklist): bad items are dropped. */
function entriesOf(data, field) {
  const items = Array.isArray(data?.[field]) ? data[field] : [];
  return items.flatMap((item) => {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.value !== 'string' || !item.value) return [];
    return [{ id: item.id, value: item.value, expires_at: typeof item.expires_at === 'number' ? item.expires_at : null }];
  });
}

const isLive = (entry, nowMs) => entry.expires_at === null || entry.expires_at > nowMs;
const when = (ms) => (ms === null ? 'never' : new Date(ms).toISOString());

const nowMs = Date.now();
const listData = (await blocklistRef.get()).data() ?? {};
const all = Object.entries(FIELDS).flatMap(([type, field]) => entriesOf(listData, field).map((e) => ({ ...e, type, field })));

function describe(e) {
  const state = isLive(e, nowMs) ? 'active' : 'expired';
  return `${e.type.padEnd(7)} ${e.value.padEnd(24)} id ${e.id} (ref ${e.id.slice(0, 6).toUpperCase()})  until ${when(e.expires_at)}  ${state}`;
}

if (values.list) {
  console.log(`admin_config/blocklist version ${listData.version ?? 0}: ${all.length} entr${all.length === 1 ? 'y' : 'ies'}`);
  for (const e of all) console.log(`  ${describe(e)}`);
  process.exit(0);
}

// --- 4. Find the block --------------------------------------------------------
let wanted = subject;
if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject)) {
  if (onEmulator && !process.env.FIREBASE_AUTH_EMULATOR_HOST) fail('Email subject on the emulator: set FIREBASE_AUTH_EMULATOR_HOST too.');
  try {
    wanted = (await getAuth(app).getUserByEmail(subject.toLowerCase())).uid;
    console.log(`Email:   ${subject} → uid ${wanted}`);
  } catch (e) {
    if (e?.code === 'auth/user-not-found') fail('No user with that email.');
    throw e;
  }
}

const ref = REF_PATTERN.exec(wanted);
const matches = all.filter(
  (e) =>
    e.id === wanted ||
    (ref && e.id.toUpperCase().startsWith(ref[1].toUpperCase())) ||
    e.value.toLowerCase() === wanted.toLowerCase(),
);

if (matches.length === 0) {
  fail(`No block matches "${subject}". A range or country may cover it: run with --list and pass that block's id.`);
}
if (matches.length > 1) {
  console.error(`"${subject}" matches ${matches.length} blocks. Pass one id:`);
  for (const e of matches) console.error(`  ${describe(e)}`);
  process.exit(1);
}

const target = matches[0];
console.log(`Remove:  ${describe(target)}`);

if (!values.yes) {
  console.log('Dry run: nothing changed. Pass --yes to remove it.');
  process.exit(0);
}

// --- 5. Write (one transaction, mirrors FirestoreBlockRepository.remove) -----
const blockRef = db.collection(BLOCKS_COLLECTION).doc(target.id);
const auditRef = db.collection(AUDIT_COLLECTION).doc();
const now = Timestamp.fromMillis(nowMs);
const iso = (ts) => (ts instanceof Timestamp ? ts.toDate().toISOString() : null);

const outcome = await db.runTransaction(async (tx) => {
  const [snap, listSnap] = await tx.getAll(blockRef, blocklistRef);
  const block = snap.exists ? snap.data() : null;
  const list = listSnap.data() ?? {};
  const current = entriesOf(list, target.field);
  if (!current.some((e) => e.id === target.id)) return 'gone';
  const remaining = current.filter((e) => e.id !== target.id && isLive(e, nowMs));

  // The `blocks/{id}` row can be missing (hand-edited list): the enforcement copy is what blocks.
  if (block && !block.removed_at) {
    tx.update(blockRef, { removed_at: now, removed_by: 'script', removed: true });
  }
  tx.set(
    blocklistRef,
    { [target.field]: remaining, version: (typeof list.version === 'number' ? list.version : 0) + 1, updated_at: FieldValue.serverTimestamp() },
    { merge: true },
  );

  // Same shape as BlockService.remove → buildAuditEntry → toAuditDoc (dates as ISO strings).
  const type = block?.type ?? target.type;
  const value = block?.value ?? target.value;
  const expiresAt = block ? iso(block.expires_at) : target.expires_at === null ? null : when(target.expires_at);
  // A row already marked removed (but still enforced) keeps its real removal time in `before`.
  const removedBefore = block ? iso(block.removed_at) : null;
  tx.set(auditRef, {
    at: FieldValue.serverTimestamp(),
    actor_uid: null,
    actor_email: 'script',
    actor_role: null,
    action: 'block.remove',
    target_type: `block_${type}`,
    target_id: target.id,
    before: { type, value, expires_at: expiresAt, removed_at: removedBefore },
    after: { type, value, expires_at: expiresAt, removed_at: removedBefore ?? now.toDate().toISOString() },
    reason: reason || (typeof block?.reason === 'string' && block.reason.trim()) || null,
    ip: null,
    user_agent: null,
  });
  return block ? 'removed' : 'removed_orphan';
});

if (outcome === 'gone') fail('That block was removed by someone else just now. Nothing changed.', 0);
console.log(`Done: ${target.type} ${target.value} unblocked (audit row ${auditRef.id}).`);
if (outcome === 'removed_orphan') console.log(`Note: no blocks/${target.id} row existed; only the enforcement copy was changed.`);
console.log('Running servers apply it within 60 s (blocklist cache).');
process.exit(0);
