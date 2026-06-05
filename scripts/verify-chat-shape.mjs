// Reads a specific room + first few messages directly from Firestore
// and asserts that every required field is present and correctly typed.
// Run: node --env-file=.env.local scripts/verify-chat-shape.mjs <ROOM_CODE>

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const code = process.argv[2];
if (!code) {
  console.error('Usage: node scripts/verify-chat-shape.mjs <ROOM_CODE>');
  process.exit(2);
}

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

const ROOM_FIELDS = {
  code: 'string',
  name: 'string|null',
  created_at: 'iso',
  expires_at: 'iso',
  ttl_hours: 'number',
  created_by: 'string|null',
  creator_tz: 'string|null',
};
const MSG_FIELDS = {
  id: 'string',
  sender_name: 'string',
  sender_id: 'string|null',
  content: 'string',
  created_at: 'iso',
  sender_tz: 'string',
};

const fails = [];
function check(label, obj, schema) {
  for (const [k, expected] of Object.entries(schema)) {
    const v = obj[k];
    const accepts = expected.split('|');
    let ok = false;
    for (const t of accepts) {
      if (t === 'null') { ok ||= v === null; }
      else if (t === 'string') { ok ||= typeof v === 'string'; }
      else if (t === 'number') { ok ||= typeof v === 'number'; }
      else if (t === 'iso') {
        ok ||= typeof v === 'string' && !Number.isNaN(new Date(v).getTime()) && v.endsWith('Z');
      }
    }
    if (!ok) {
      fails.push(`${label}: field "${k}" expected ${expected}, got ${typeof v} (${JSON.stringify(v)})`);
    }
  }
}

const roomSnap = await db.collection('rooms').doc(code).get();
if (!roomSnap.exists) {
  console.error(`Room ${code} not found`);
  process.exit(1);
}
const room = roomSnap.data();
console.log('--- room ---');
console.log(JSON.stringify(room, null, 2));
check('room', room, ROOM_FIELDS);

const msgsSnap = await db
  .collection('rooms').doc(code)
  .collection('messages').orderBy('created_at', 'asc').limit(3).get();
console.log(`\n--- first ${msgsSnap.size} messages ---`);
msgsSnap.docs.forEach((d, i) => {
  const m = d.data();
  console.log(`message[${i}] id=${d.id}: ${JSON.stringify(m).slice(0, 200)}${JSON.stringify(m).length > 200 ? '…' : ''}`);
  check(`message[${i}]`, m, MSG_FIELDS);
  if (m.id !== d.id) fails.push(`message[${i}]: m.id (${m.id}) != doc id (${d.id})`);
});

console.log('\n--- result ---');
if (fails.length === 0) {
  console.log(`✓ All fields valid on room + ${msgsSnap.size} messages`);
  process.exit(0);
} else {
  console.error(`✗ ${fails.length} validation failures:`);
  fails.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
