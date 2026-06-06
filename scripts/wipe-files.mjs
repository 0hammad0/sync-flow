// ONE-OFF: clear all stored files & videos.
// - every object in the R2 bucket (file shares + chat attachments)
// - all docs in `files` and `receive_sessions`
// - chat messages that carried an attachment (text messages/rooms stay)
// Usage: node scripts/wipe-files.mjs
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

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

// --- 1. Empty the R2 bucket ---
let objectsDeleted = 0;
let token;
do {
  const page = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token })
  );
  const keys = (page.Contents ?? []).map((o) => o.Key).filter(Boolean);
  if (keys.length > 0) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      })
    );
    objectsDeleted += keys.length;
  }
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);
console.log(`R2: deleted ${objectsDeleted} objects`);

// --- 2. Delete all `files` and `receive_sessions` docs ---
async function wipeCollection(name) {
  let count = 0;
  for (;;) {
    const snap = await db.collection(name).limit(300).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    count += snap.size;
  }
  console.log(`Firestore: deleted ${count} docs from '${name}'`);
  return count;
}
await wipeCollection('files');
await wipeCollection('receive_sessions');

// --- 3. Remove attachment-bearing chat messages (media is gone from R2) ---
let attMsgs = 0;
const rooms = await db.collection('rooms').get();
for (const roomDoc of rooms.docs) {
  const msgs = await roomDoc.ref.collection('messages').get();
  const toDelete = msgs.docs.filter((d) => d.data().attachment?.key);
  for (let i = 0; i < toDelete.length; i += 300) {
    const batch = db.batch();
    toDelete.slice(i, i + 300).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  attMsgs += toDelete.length;
}
console.log(`Firestore: deleted ${attMsgs} attachment messages across ${rooms.size} rooms (text messages kept)`);

// --- 4. Verify ---
const left = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 1 }));
const filesLeft = (await db.collection('files').limit(1).get()).size;
const sessLeft = (await db.collection('receive_sessions').limit(1).get()).size;
if ((left.KeyCount ?? 0) > 0 || filesLeft > 0 || sessLeft > 0) {
  console.error('VERIFY FAILED: leftovers detected');
  process.exit(1);
}
console.log('VERIFIED: bucket empty, files + receive_sessions collections empty');
