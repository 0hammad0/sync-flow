// E2E test: when a room expires, the cleanup cron removes its Firestore docs
// AND its R2 attachments. Seeds an already-expired room with a message + a
// real R2 object, runs /api/cleanup, then verifies everything is gone.
// Usage: node scripts/e2e-cleanup.mjs [baseUrl]
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

const BASE = process.argv[2] || 'http://localhost:3001';
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});
const db = getFirestore();
const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET;

// --- 1. Seed an expired room with a message + attachment object ---
const code = 'E2ECLNUP'; // valid alphabet (no I O 0 1 L), 8 chars
const key = `chat/${code}/testtoken/cleanup-probe.txt`;
const past = new Date(Date.now() - 3600_000).toISOString();
const pastCreated = new Date(Date.now() - 7200_000).toISOString();

await db.collection('rooms').doc(code).set({
  code,
  name: 'cleanup e2e',
  created_at: pastCreated,
  expires_at: past, // already expired
  ttl_hours: 1,
  created_by: null,
  creator_tz: 'UTC',
});
await db.collection('rooms').doc(code).collection('messages').doc('m1').set({
  id: 'm1',
  sender_name: 'Probe',
  sender_id: null,
  content: 'attachment that must be cleaned up',
  created_at: pastCreated,
  sender_tz: 'UTC',
  kind: 'chat',
  attachment: { key, name: 'cleanup-probe.txt', size: 11, mime_type: 'text/plain' },
});
await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: 'probe bytes', ContentType: 'text/plain' }));
console.log(`1. seeded expired room ${code} with message + R2 object ${key}`);

// --- 2. Run the cleanup cron endpoint ---
const res = await fetch(`${BASE}/api/cleanup`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.CRON_SECRET || 'e2e'}` },
});
const result = await res.json();
if (!res.ok || !result.success) fail(`cleanup endpoint: HTTP ${res.status} ${JSON.stringify(result)}`);
console.log(`2. cleanup ran: roomsDeleted=${result.roomsDeleted}`);

// --- 3. Verify everything is gone ---
const roomSnap = await db.collection('rooms').doc(code).get();
if (roomSnap.exists) fail('room doc still exists after cleanup');
const msgSnap = await db.collection('rooms').doc(code).collection('messages').get();
if (!msgSnap.empty) fail(`messages still exist after cleanup (${msgSnap.size})`);
const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `chat/${code}/` }));
if ((listed.KeyCount ?? 0) !== 0) fail(`R2 objects still exist under chat/${code}/: ${listed.KeyCount}`);
console.log('3. room doc gone, messages gone, R2 prefix empty');
console.log('PASS: expired-room cleanup removes Firestore docs and R2 attachments');
process.exit(0);
