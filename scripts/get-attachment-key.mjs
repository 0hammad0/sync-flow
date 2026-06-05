// Print the attachment key of a chat message (diagnostics helper).
// Usage: node scripts/get-attachment-key.mjs <roomCode> <messageId>
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
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
const snap = await getFirestore()
  .collection('rooms').doc(process.argv[2])
  .collection('messages').doc(process.argv[3])
  .get();
if (!snap.exists) {
  console.error('message not found');
  process.exit(1);
}
console.log(snap.data().attachment?.key ?? '');
