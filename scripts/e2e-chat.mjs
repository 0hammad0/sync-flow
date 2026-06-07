// E2E test of the chat pipeline, mirroring ChatRoom.tsx exactly:
// - create room via POST /api/chat
// - subscribe to rooms/{code}/messages with the client SDK (onSnapshot, unauthenticated guest)
// - two "users" send via POST /api/chat/{code}/messages
// - assert real-time delivery, ordering, content, and measure push latency
// Usage: node scripts/e2e-chat.mjs [baseUrl]
import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, query, orderBy, limitToLast, onSnapshot,
} from 'firebase/firestore';
// (presence uses the same collection/onSnapshot imports)
import { readFileSync } from 'fs';

const BASE = process.argv[2] || 'http://localhost:3001';
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

// Minimal .env.local loader
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}

// --- 1. Create a room (like ChatLobby) ---
const createRes = await fetch(`${BASE}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'e2e test room', ttlHours: 1, tz: 'Asia/Karachi' }),
});
const room = await createRes.json();
if (!room.success) fail('create room: ' + JSON.stringify(room));
console.log(`1. room created   code=${room.code}  url=${room.url}`);

// --- 2. Subscribe like ChatRoom.tsx (guest, no auth) ---
const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
});
const db = getFirestore(app);

let snapshots = [];
let snapshotError = null;
const q = query(
  collection(db, 'rooms', room.code, 'messages'),
  orderBy('created_at', 'asc'),
  limitToLast(500)
);
const unsub = onSnapshot(
  q,
  (snap) => { snapshots = snap.docs.map((d) => d.data()); },
  (err) => { snapshotError = err; }
);

// Wait for initial (empty) snapshot or permission error
await new Promise((r) => setTimeout(r, 3000));
if (snapshotError) fail(`onSnapshot listener error (deployed rules block client reads?): ${snapshotError.code} ${snapshotError.message}`);
console.log(`2. guest listener attached OK (deployed rules allow client read), initial messages: ${snapshots.length}`);

// --- 3. Send messages as two different users ---
async function send(senderName, content, extra = {}) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat/${room.code}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderName, content, tz: 'Asia/Karachi', ...extra }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) fail(`send as ${senderName}: HTTP ${res.status} ${JSON.stringify(data)}`);
  // Wait until the listener sees it (real-time delivery, like the other phone)
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (snapshots.some((s) => s.id === data.id)) {
      return { ms: Date.now() - t0, id: data.id };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  fail(`message from ${senderName} never arrived via onSnapshot within 15s`);
}

// --- 2b. Join announcements (presence) ---
async function presence(senderName, event) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat/${room.code}/presence`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // sendBeacon-style body
    body: JSON.stringify({ event, senderName, tz: 'Asia/Karachi' }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) fail(`presence ${event} as ${senderName}: HTTP ${res.status} ${JSON.stringify(data)}`);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const m = snapshots.find((s) => s.id === data.id);
    if (m) {
      if (m.kind !== 'system') fail(`presence message kind is ${m.kind}, expected system`);
      if (m.content !== (event === 'join' ? 'joined' : 'left')) fail(`presence content wrong: ${m.content}`);
      return Date.now() - t0;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  fail(`presence ${event} from ${senderName} never arrived via onSnapshot within 15s`);
}
await presence('Alice', 'join');
await presence('Bob', 'join');
console.log('2b. join announcements delivered as system messages');

const r1 = await send('Alice', 'hello from Alice 👋');
const lat1 = r1.ms;
console.log(`3. Alice -> delivered to listener in ${lat1}ms`);
const r2 = await send('Bob', 'hey Alice!\nsecond line works too');
const lat2 = r2.ms;
console.log(`4. Bob   -> delivered to listener in ${lat2}ms`);

// --- 3r. Reply-quoting: Bob replies to Alice's message ---
{
  const reply = await send('Bob', 'replying to you!', { replyToId: r1.id });
  const m = snapshots.find((s) => s.id === reply.id);
  if (!m.reply_to || m.reply_to.id !== r1.id) fail('reply_to missing or wrong id');
  if (m.reply_to.sender_name !== 'Alice') fail(`reply_to.sender_name wrong: ${m.reply_to.sender_name}`);
  if (m.reply_to.snippet !== 'hello from Alice 👋') fail(`reply_to.snippet wrong: ${m.reply_to.snippet}`);
  const badReply = await fetch(`${BASE}/api/chat/${room.code}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderName: 'Bob', content: 'x', tz: 'UTC', replyToId: 'aaaaaaaaaaaaaaaaaaaa' }),
  });
  if (badReply.status !== 400) fail(`reply to nonexistent message: expected 400, got ${badReply.status}`);
  console.log('4r. reply-quoting: server-built quote ref correct, bogus target rejected');
}

// --- 3s. Reactions: WhatsApp toggle semantics, keyed by per-device id ---
{
  async function react(senderName, deviceId, messageId, emoji) {
    const res = await fetch(`${BASE}/api/chat/${room.code}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, emoji, senderName, deviceId }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) fail(`react ${emoji}: HTTP ${res.status} ${JSON.stringify(data)}`);
    return data.reacted;
  }
  async function waitReactions(messageId, predicate, label) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const m = snapshots.find((s) => s.id === messageId);
      if (m && predicate(m.reactions ?? {})) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    fail(`reactions never reached expected state: ${label}`);
  }
  const hasReactor = (list, id) => (list ?? []).some((r) => r.id === id);

  const BOB = 'device-bob-11111111';
  const CHARLIE = 'device-charlie-1111';
  if ((await react('Bob', BOB, r1.id, '👍')) !== true) fail('first 👍 should add');
  await waitReactions(r1.id, (re) => hasReactor(re['👍'], BOB), 'Bob 👍 added');
  await react('Charlie', CHARLIE, r1.id, '👍');
  await waitReactions(r1.id, (re) => re['👍']?.length === 2, 'two 👍');
  // Bob switches to ❤️ — replaces his 👍 (one reaction per device)
  if ((await react('Bob', BOB, r1.id, '❤️')) !== true) fail('switching emoji should add');
  await waitReactions(
    r1.id,
    (re) => hasReactor(re['❤️'], BOB) && re['👍']?.length === 1 && !hasReactor(re['👍'], BOB),
    'Bob switched 👍->❤️'
  );
  // Bob taps ❤️ again — removes it entirely
  if ((await react('Bob', BOB, r1.id, '❤️')) !== false) fail('same emoji again should remove');
  await waitReactions(r1.id, (re) => !re['❤️'], 'Bob ❤️ removed');
  // Server rejects emojis outside the WhatsApp six
  const badEmoji = await fetch(`${BASE}/api/chat/${room.code}/reactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId: r1.id, emoji: '🦄', senderName: 'Bob', deviceId: BOB }),
  });
  if (badEmoji.status !== 400) fail(`invalid emoji: expected 400, got ${badEmoji.status}`);
  console.log('4s. reactions: add, multi-user count, switch (one per device), remove, invalid emoji rejected');

  // --- Same display name, two devices: identities must stay distinct ---
  const SAM_A = 'device-samA-1111111';
  const SAM_B = 'device-samB-1111111';
  await react('Sam', SAM_A, r2.id, '😂');
  await react('Sam', SAM_B, r2.id, '😂');
  await waitReactions(
    r2.id,
    (re) => hasReactor(re['😂'], SAM_A) && hasReactor(re['😂'], SAM_B) && re['😂']?.length === 2,
    'two Sams both counted'
  );
  // Sam A removes — Sam B's reaction must survive
  if ((await react('Sam', SAM_A, r2.id, '😂')) !== false) fail('Sam A toggle-off should remove');
  await waitReactions(
    r2.id,
    (re) => !hasReactor(re['😂'], SAM_A) && hasReactor(re['😂'], SAM_B) && re['😂']?.length === 1,
    'only Sam A removed, Sam B kept'
  );
  // Same-name senders: device id rides on messages too
  const samMsgA = await send('Sam', 'I am Sam on laptop', { deviceId: SAM_A });
  const samMsgB = await send('Sam', 'I am Sam on phone', { deviceId: SAM_B });
  const mA = snapshots.find((s) => s.id === samMsgA.id);
  const mB = snapshots.find((s) => s.id === samMsgB.id);
  if (mA.sender_device_id !== SAM_A || mB.sender_device_id !== SAM_B)
    fail(`sender_device_id wrong: ${mA.sender_device_id}, ${mB.sender_device_id}`);
  console.log('4t. same-name fix: two "Sam" devices kept distinct for reactions AND message ownership');
}

// --- 3p. Typing indicator + online status (presence subcollection) ---
{
  let presenceDocs = [];
  const unsubP = onSnapshot(
    collection(db, 'rooms', room.code, 'presence'),
    (snap) => { presenceDocs = snap.docs.map((d) => d.data()); },
    (err) => fail(`presence listener error (rules not deployed?): ${err.code}`)
  );
  async function beat(senderName, deviceId, typing) {
    const res = await fetch(`${BASE}/api/chat/${room.code}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, senderName, typing }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) fail(`heartbeat: HTTP ${res.status} ${JSON.stringify(data)}`);
  }
  async function waitPresence(predicate, label) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (predicate(presenceDocs)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    fail(`presence never reached state: ${label}`);
  }
  const ALICE_DEV = 'device-alice-111111';
  // keep-alive beat → online (recent last_seen, no typing flag)
  await beat('Alice', ALICE_DEV, undefined);
  await waitPresence(
    (ps) => ps.some((p) => p.device_id === ALICE_DEV && Date.now() - new Date(p.last_seen).getTime() < 60_000),
    'Alice online'
  );
  // typing beat → typing_until in the future
  await beat('Alice', ALICE_DEV, true);
  await waitPresence(
    (ps) => ps.some((p) => p.device_id === ALICE_DEV && p.typing_until && new Date(p.typing_until).getTime() > Date.now()),
    'Alice typing'
  );
  // explicit stop → flag cleared
  await beat('Alice', ALICE_DEV, false);
  await waitPresence(
    (ps) => ps.some((p) => p.device_id === ALICE_DEV && p.typing_until === null),
    'Alice stopped typing'
  );
  // keep-alive must NOT stomp a live typing flag
  await beat('Alice', ALICE_DEV, true);
  await beat('Alice', ALICE_DEV, undefined);
  await waitPresence(
    (ps) => ps.some((p) => p.device_id === ALICE_DEV && p.typing_until && new Date(p.typing_until).getTime() > Date.now()),
    'keep-alive preserved typing flag'
  );
  // leave event removes the presence doc
  await fetch(`${BASE}/api/chat/${room.code}/presence`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ event: 'leave', senderName: 'Alice', tz: 'UTC', deviceId: ALICE_DEV }),
  });
  await waitPresence((ps) => !ps.some((p) => p.device_id === ALICE_DEV), 'Alice presence removed on leave');
  unsubP();
  console.log('4p. presence: online beat, typing set/clear, keep-alive preserves typing, leave removes doc');
}

// --- 3b. Leave announcement ---
await presence('Bob', 'leave');
console.log('4b. leave announcement delivered as system message');

// --- 3c. Attachment: upload a PNG with caption, verify real-time delivery + serving ---
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
); // 1x1 red pixel PNG
const attForm = new FormData();
attForm.append('file', new Blob([pngBytes], { type: 'image/png' }), 'pixel.png');
attForm.append('originalName', 'pixel.png');
attForm.append('senderName', 'Alice');
attForm.append('caption', 'check this image 📷');
attForm.append('tz', 'Asia/Karachi');
const attRes = await fetch(`${BASE}/api/chat/${room.code}/attachments`, { method: 'POST', body: attForm });
const att = await attRes.json();
if (!attRes.ok || !att.success) fail(`attachment upload: HTTP ${attRes.status} ${JSON.stringify(att)}`);
{
  const deadline = Date.now() + 15000;
  let m;
  while (Date.now() < deadline && !(m = snapshots.find((s) => s.id === att.id))) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!m) fail('attachment message never arrived via onSnapshot');
  if (!m.attachment || m.attachment.name !== 'pixel.png' || m.attachment.mime_type !== 'image/png')
    fail('attachment metadata wrong: ' + JSON.stringify(m.attachment));
  if (m.content !== 'check this image 📷') fail('caption mismatch');
  // Serve it the way <img> does: follow the redirect, compare bytes
  const dl = await fetch(`${BASE}/api/chat/${room.code}/attachments?key=${encodeURIComponent(m.attachment.key)}`);
  if (!dl.ok) fail(`attachment GET failed: ${dl.status}`);
  const got = Buffer.from(await dl.arrayBuffer());
  if (!got.equals(pngBytes)) fail('attachment bytes do not round-trip');
  // Security: a key outside this room's prefix must be rejected
  const sneaky = await fetch(`${BASE}/api/chat/${room.code}/attachments?key=${encodeURIComponent('chat/OTHERROOM/x/секрет.png')}`);
  if (sneaky.status !== 400) fail(`cross-room key: expected 400, got ${sneaky.status}`);
  console.log('4c. image attachment: real-time delivery, caption, byte round-trip, cross-room key rejected');
}

// --- 3e. Multi-file album: uploadOnly x2 -> ONE message with attachments[] ---
{
  async function uploadOnly(name, bytes, type) {
    const f = new FormData();
    f.append('file', new Blob([bytes], { type }), name);
    f.append('originalName', name);
    f.append('senderName', 'Alice');
    f.append('caption', '');
    f.append('tz', 'UTC');
    f.append('uploadOnly', '1');
    const res = await fetch(`${BASE}/api/chat/${room.code}/attachments`, { method: 'POST', body: f });
    const data = await res.json();
    if (!res.ok || !data.success || !data.attachment) fail(`uploadOnly ${name}: ${JSON.stringify(data)}`);
    return data.attachment;
  }
  const a1 = await uploadOnly('one.png', pngBytes, 'image/png');
  const a2 = await uploadOnly('two.bin', Buffer.from('album file two'), 'application/octet-stream');
  const msgRes = await fetch(`${BASE}/api/chat/${room.code}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      senderName: 'Alice', content: 'album caption', tz: 'UTC',
      deviceId: 'device-alice-111111', attachments: [a1, a2],
    }),
  });
  const msg = await msgRes.json();
  if (!msgRes.ok || !msg.success) fail(`album message: HTTP ${msgRes.status} ${JSON.stringify(msg)}`);
  let m;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !(m = snapshots.find((s) => s.id === msg.id))) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!m) fail('album message never arrived via onSnapshot');
  if (m.attachments?.length !== 2) fail(`expected 2 album attachments, got ${m.attachments?.length}`);
  if (m.content !== 'album caption') fail('album caption mismatch');
  // both files must serve
  for (const a of m.attachments) {
    const dl = await fetch(`${BASE}/api/chat/${room.code}/attachments?key=${encodeURIComponent(a.key)}`);
    if (!dl.ok) fail(`album file ${a.name} GET failed: ${dl.status}`);
  }
  // album referencing a key OUTSIDE this room's prefix must be rejected
  const sneaky = await fetch(`${BASE}/api/chat/${room.code}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      senderName: 'Alice', content: '', tz: 'UTC',
      attachments: [{ ...a1, key: 'chat/OTHERROOM/x/evil.png' }],
    }),
  });
  if (sneaky.status !== 400) fail(`cross-room album key: expected 400, got ${sneaky.status}`);
  console.log('4e. album: 2 files in one message, both serve, caption kept, cross-room key rejected');
}

// --- 3d. Long text messages (up to 15MB, stored in R2 with inline preview) ---
{
  const longBody = 'long message line with some formatting\n  indented line\n'.repeat(40_000); // ~2.1MB
  const preview = longBody.slice(0, 500);
  const form = new FormData();
  form.append('file', new Blob([longBody], { type: 'text/plain' }), 'long-message.txt');
  form.append('originalName', 'long-message.txt');
  form.append('senderName', 'Alice');
  form.append('caption', preview);
  form.append('tz', 'Asia/Karachi');
  form.append('longText', '1');
  const res = await fetch(`${BASE}/api/chat/${room.code}/attachments`, { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok || !data.success) fail(`long text upload: HTTP ${res.status} ${JSON.stringify(data)}`);
  let m;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !(m = snapshots.find((s) => s.id === data.id))) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!m) fail('long text message never arrived via onSnapshot');
  if (m.attachment?.is_long_text !== true) fail('is_long_text flag missing');
  if (m.content !== preview) fail('long text preview (content) mismatch');
  const dl = await fetch(`${BASE}/api/chat/${room.code}/attachments?key=${encodeURIComponent(m.attachment.key)}`);
  const fullText = await dl.text();
  if (fullText !== longBody) fail(`long text body mismatch: got ${fullText.length} chars, want ${longBody.length}`);
  // over the 15MB ceiling → rejected
  const tooBig = new FormData();
  tooBig.append('file', new Blob([new Uint8Array(16 * 1024 * 1024)], { type: 'text/plain' }), 'long-message.txt');
  tooBig.append('originalName', 'long-message.txt');
  tooBig.append('senderName', 'Alice');
  tooBig.append('caption', 'x');
  tooBig.append('tz', 'UTC');
  tooBig.append('longText', '1');
  const big = await fetch(`${BASE}/api/chat/${room.code}/attachments`, { method: 'POST', body: tooBig });
  if (big.status !== 413) fail(`16MB long text: expected 413, got ${big.status}`);
  console.log(`4d. long text: 2.1MB message stored + preview inline + full body round-trips (${fullText.length.toLocaleString()} chars), 16MB rejected`);
}

// --- 4. Assertions: order, content, server timestamps ---
const chatMsgs = snapshots.filter(
  (s) => s.kind !== 'system' && !s.attachment && !(s.attachments?.length)
);
const sysMsgs = snapshots.filter((s) => s.kind === 'system');
if (chatMsgs.length !== 5) fail(`expected 5 text chat messages (2 + 1 reply + 2 Sams), listener has ${chatMsgs.length}`);
if (sysMsgs.length !== 4) fail(`expected 4 system messages (2 joins + 2 leaves), got ${sysMsgs.length}`);
const [m1, m2] = chatMsgs;
if (m1.sender_name !== 'Alice' || m2.sender_name !== 'Bob') fail(`wrong order/senders: ${m1.sender_name}, ${m2.sender_name}`);
if (m1.content !== 'hello from Alice 👋') fail('Alice content mismatch (emoji/unicode broken?)');
if (m2.content !== 'hey Alice!\nsecond line works too') fail('Bob multiline content mismatch');
if (!(m1.created_at < m2.created_at)) fail('created_at ordering broken');
console.log('5. ordering, unicode, multiline, server timestamps all OK');

// --- 5. Expired-room and bad-input rejection ---
const bad = await fetch(`${BASE}/api/chat/ZZZZZZZZ/messages`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ senderName: 'X', content: 'hi', tz: 'UTC' }),
});
if (bad.status !== 404) fail(`nonexistent room: expected 404, got ${bad.status}`);
const empty = await fetch(`${BASE}/api/chat/${room.code}/messages`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ senderName: 'X', content: '', tz: 'UTC' }),
});
if (empty.status !== 400) fail(`empty content: expected 400, got ${empty.status}`);
console.log('6. bad room -> 404, empty message -> 400');

unsub();
console.log(`PASS: chat is working end-to-end (avg real-time latency ${(Math.round((lat1 + lat2) / 2))}ms)`);
process.exit(0);
