import { createHash } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './admin';
import { generateRoomCode, normalizeReactors, sanitizeDeviceId } from '@/shared/lib/utils';
import { deletePrefix } from '@/shared/lib/r2';
import { MAX_UPLOAD_BYTES } from '@/shared/lib/limits';
import type {
  ChatAttachment,
  ChatMessage,
  ChatPresence,
  ChatReactor,
  ChatReplyRef,
  ChatRoom,
} from '@/types';

export const ROOMS_COLLECTION = 'rooms';
export const MESSAGES_SUBCOLLECTION = 'messages';

export const MAX_MESSAGE_BYTES = 900_000;     // headroom under Firestore's 1MB doc cap
export const MAX_NAME_LENGTH = 64;
export const MAX_ROOM_NAME_LENGTH = 80;
export const MAX_ATTACHMENT_BYTES = MAX_UPLOAD_BYTES; // same cap as file sharing
export const ALLOWED_TTL_HOURS: ReadonlyArray<1 | 24 | 168> = [1, 24, 168];
// A room never lives longer than this from its creation, extensions included.
export const MAX_ROOM_LIFETIME_HOURS = 168;
// One "Extend" adds this much time (capped by MAX_ROOM_LIFETIME_HOURS).
export const EXTEND_HOURS = 24;

/**
 * Stored room doc = the public ChatRoom shape plus `expires_at_ts`, a real
 * Firestore Timestamp mirror of `expires_at`. Security rules can't parse ISO
 * strings, so firestore.rules checks expiry against this field. It is never
 * returned to callers (Timestamps can't cross the server → client boundary).
 */
type StoredRoom = ChatRoom & { expires_at_ts?: Timestamp };

function toPublicRoom(data: StoredRoom): ChatRoom {
  const { expires_at_ts: _ts, ...room } = data;
  void _ts;
  return room;
}

/** R2 prefix holding every attachment of a room — deleted when the room expires. */
export function roomStoragePrefix(code: string): string {
  return `chat/${code}/`;
}

function roomRef(code: string) {
  return adminDb().collection(ROOMS_COLLECTION).doc(code);
}

function messagesRef(code: string) {
  return roomRef(code).collection(MESSAGES_SUBCOLLECTION);
}

/**
 * The public form of a device id. The browser keeps its raw id secret and
 * sends it on every write; only sha256(raw) is stored (messages, presence,
 * reactions), so a value read from Firestore can't be replayed to act as
 * that device. Must match deviceIdHash() in features/chat/lib/chat-helpers.ts.
 */
export function deviceKey(raw: unknown): string | null {
  const id = sanitizeDeviceId(raw);
  return id ? createHash('sha256').update(id).digest('hex').slice(0, 32) : null;
}

// One doc per attachment key that is already part of a message. Created in
// the same batch as the message, so a key can only ever be posted once.
// Clients can't read it (default-deny rules); room cleanup deletes it.
function attachmentClaimRef(code: string, key: string) {
  const id = createHash('sha256').update(key).digest('hex').slice(0, 32);
  return roomRef(code).collection('attachment_claims').doc(id);
}

/** True when this attachment key is already part of a message. */
export async function isAttachmentClaimed(code: string, key: string): Promise<boolean> {
  return (await attachmentClaimRef(code, key).get()).exists;
}

/**
 * Create a room with a collision-resistant random code. Retries on the
 * vanishingly rare case that `.create()` (which fails-if-exists) hits an
 * existing doc.
 */
export async function createRoom(input: {
  name: string | null;
  ttl_hours: 1 | 24 | 168;
  created_by: string | null;
  creator_tz: string | null;
}): Promise<ChatRoom> {
  if (!ALLOWED_TTL_HOURS.includes(input.ttl_hours)) {
    throw new Error('Invalid ttl_hours');
  }
  const now = Date.now();
  const created_at = new Date(now).toISOString();
  const expires_at = new Date(now + input.ttl_hours * 3600 * 1000).toISOString();

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const doc: ChatRoom = {
      code,
      name: input.name,
      created_at,
      expires_at,
      ttl_hours: input.ttl_hours,
      created_by: input.created_by,
      creator_tz: input.creator_tz,
    };
    try {
      const stored: StoredRoom = { ...doc, expires_at_ts: Timestamp.fromDate(new Date(expires_at)) };
      await roomRef(code).create(stored);
      return doc;
    } catch (err: unknown) {
      // Firestore "ALREADY_EXISTS" → retry with a fresh code.
      if (!isAlreadyExistsError(err)) throw err;
    }
  }
  throw new Error('Failed to generate a unique room code after 5 attempts');
}

/** True for Firestore's ALREADY_EXISTS (gRPC code 6), thrown by `.create()` on an existing doc. */
export function isAlreadyExistsError(err: unknown): boolean {
  if ((err as { code?: number })?.code === 6) return true;
  return /already exists/i.test((err as { message?: string })?.message || '');
}

export async function getRoom(code: string): Promise<ChatRoom | null> {
  const snap = await roomRef(code).get();
  if (!snap.exists) return null;
  const data = snap.data() as StoredRoom;
  // Rooms created before `expires_at_ts` existed: backfill it on first touch
  // so the security rules (which require it) let clients read the room.
  if (!(data.expires_at_ts instanceof Timestamp) && data.expires_at) {
    await snap.ref
      .update({ expires_at_ts: Timestamp.fromDate(new Date(data.expires_at)) })
      .catch((err) => console.error(`expires_at_ts backfill failed for ${code}:`, err));
  }
  return toPublicRoom(data);
}

export type ExtendResult =
  | { ok: true; expires_at: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'anonymous_room' | 'not_owner' | 'at_max' };

/**
 * Owner-only "Extend": push expiry out by EXTEND_HOURS, never past
 * created_at + MAX_ROOM_LIFETIME_HOURS. Transactional so two clicks can't
 * race. Rooms made by guests (created_by null) have no owner to check.
 */
export async function extendRoom(code: string, uid: string): Promise<ExtendResult> {
  const ref = roomRef(code);
  return adminDb().runTransaction(async (txn): Promise<ExtendResult> => {
    const snap = await txn.get(ref);
    if (!snap.exists) return { ok: false, reason: 'not_found' };
    const room = snap.data() as StoredRoom;
    if (isRoomExpired(room)) return { ok: false, reason: 'expired' };
    if (!room.created_by) return { ok: false, reason: 'anonymous_room' };
    if (room.created_by !== uid) return { ok: false, reason: 'not_owner' };

    const current = new Date(room.expires_at).getTime();
    const cap = new Date(room.created_at).getTime() + MAX_ROOM_LIFETIME_HOURS * 3600 * 1000;
    const next = Math.min(current + EXTEND_HOURS * 3600 * 1000, cap);
    // Less than a minute of headroom left — treat as already at the cap.
    if (next - current < 60_000) return { ok: false, reason: 'at_max' };

    const expires_at = new Date(next).toISOString();
    txn.update(ref, { expires_at, expires_at_ts: Timestamp.fromDate(new Date(next)) });
    return { ok: true, expires_at };
  });
}

export function isRoomExpired(room: Pick<ChatRoom, 'expires_at'>): boolean {
  return new Date(room.expires_at) < new Date();
}

/**
 * Sender display name: strip control characters (codepoints 0-31, 127, 128-159),
 * trim, and cap at MAX_NAME_LENGTH. Returns '' when nothing usable remains.
 */
export function sanitizeSenderName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let cleaned = '';
  for (const ch of raw) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 32 && cp !== 127 && !(cp >= 128 && cp <= 159)) cleaned += ch;
  }
  return cleaned.trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * Append a message to the room. Server-stamps `created_at` — never trust the
 * client clock. Caller is expected to have already validated the room exists.
 *
 * With `id`, the doc is written with `.create()` under that id, so a second
 * call with the same id throws ALREADY_EXISTS (see isAlreadyExistsError).
 * The attachment route uses this to make each upload ticket single-use.
 *
 * With `claimKeys`, each key is claimed in the same atomic batch; if any key
 * was already claimed, nothing is written and ALREADY_EXISTS is thrown.
 */
export async function addMessage(
  code: string,
  input: {
    sender_name: string;
    sender_id: string | null;
    sender_device_id?: string | null;
    content: string;
    sender_tz: string;
    kind?: 'chat' | 'system';
    attachment?: ChatAttachment;
    attachments?: ChatAttachment[];
    reply_to?: ChatReplyRef;
  },
  opts: { id?: string; claimKeys?: string[] } = {}
): Promise<ChatMessage> {
  if (Buffer.byteLength(input.content, 'utf8') > MAX_MESSAGE_BYTES) {
    throw new Error(`Message exceeds ${MAX_MESSAGE_BYTES} bytes`);
  }
  const docRef = opts.id ? messagesRef(code).doc(opts.id) : messagesRef(code).doc();
  const message: ChatMessage = {
    id: docRef.id,
    sender_name: input.sender_name,
    sender_id: input.sender_id,
    sender_device_id: input.sender_device_id ?? null,
    content: input.content,
    created_at: new Date().toISOString(),
    sender_tz: input.sender_tz,
    kind: input.kind ?? 'chat',
    attachment: input.attachment ?? null,
    attachments: input.attachments ?? null,
    reply_to: input.reply_to ?? null,
  };
  if (opts.claimKeys?.length) {
    const batch = adminDb().batch();
    for (const key of opts.claimKeys) {
      batch.create(attachmentClaimRef(code, key), { message_id: docRef.id });
    }
    batch.create(docRef, message);
    await batch.commit();
  } else if (opts.id) await docRef.create(message);
  else await docRef.set(message);
  return message;
}

/** All attachments of a message — album field first, legacy single fallback. */
export function messageAttachments(m: ChatMessage): ChatAttachment[] {
  if (m.attachments?.length) return m.attachments;
  return m.attachment ? [m.attachment] : [];
}

export async function getMessage(code: string, messageId: string): Promise<ChatMessage | null> {
  const snap = await messagesRef(code).doc(messageId).get();
  if (!snap.exists) return null;
  return snap.data() as ChatMessage;
}

/**
 * Build the denormalized quote reference stored on a reply. The snippet is
 * server-built from the REAL target message, so quotes can't be forged.
 */
export function buildReplyRef(target: ChatMessage): ChatReplyRef {
  const atts = messageAttachments(target);
  let attachment_kind: ChatReplyRef['attachment_kind'] = null;
  if (atts.length > 0) {
    const mime = atts[0].mime_type || '';
    attachment_kind = mime.startsWith('image/')
      ? 'image'
      : mime.startsWith('video/')
        ? 'video'
        : mime.startsWith('audio/')
          ? 'audio'
          : 'file';
  }
  const voice = atts.length === 1 ? atts[0].voice : undefined;
  const snippet = target.content
    ? target.content.slice(0, 120)
    : voice
      ? `Voice message (${voiceClock(voice.duration_ms)})`
      : atts.length > 1
      ? `${atts[0].name} +${atts.length - 1} more`
      : (atts[0]?.name ?? '');
  return { id: target.id, sender_name: target.sender_name, snippet, attachment_kind };
}

/** 0:07 / 1:23 — kept local so this server module stays free of feature imports. */
function voiceClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

/** Cap on stored listeners per note — bounds the doc size in big rooms. */
const MAX_PLAYED_BY = 200;

/**
 * Record that a listener played a voice note (WhatsApp's "played" state).
 * Only voice notes count, the sender never counts, and each device is
 * stored once. Returns true when this call added the listener.
 */
export async function markVoicePlayed(
  code: string,
  messageId: string,
  listener: string
): Promise<boolean> {
  const ref = messagesRef(code).doc(messageId);
  return adminDb().runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) throw new Error('message_not_found');
    const data = snap.data() as ChatMessage;
    const atts = messageAttachments(data);
    if (data.kind === 'system' || atts.length !== 1 || !atts[0].voice) {
      throw new Error('not_a_voice_note');
    }
    if (data.sender_device_id && data.sender_device_id === listener) return false;
    const played = data.played_by ?? [];
    if (played.includes(listener) || played.length >= MAX_PLAYED_BY) return false;
    txn.update(ref, { played_by: [...played, listener] });
    return true;
  });
}

/**
 * Toggle a reaction, WhatsApp-style: one reaction per DEVICE per message —
 * picking a new emoji replaces the old one, picking the same emoji removes it.
 * Identity is the per-device id, so two people sharing a display name stay
 * distinct. Runs in a transaction so concurrent reactions don't clobber each
 * other. Returns true when the reaction is now present, false when removed.
 */
export async function toggleReaction(
  code: string,
  messageId: string,
  emoji: string,
  reactor: ChatReactor
): Promise<boolean> {
  const ref = messagesRef(code).doc(messageId);
  return adminDb().runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) throw new Error('message_not_found');
    const data = snap.data() as ChatMessage;
    if (data.kind === 'system') throw new Error('cannot_react_to_system');

    // Normalize legacy name-string entries to {id, name} as we rewrite.
    const raw = (data.reactions ?? {}) as Record<string, unknown>;
    const reactions: Record<string, ChatReactor[]> = {};
    for (const key of Object.keys(raw)) {
      reactions[key] = normalizeReactors(raw[key]);
    }

    const hadThisEmoji = (reactions[emoji] ?? []).some((r) => r.id === reactor.id);
    // Drop this device's existing reaction from every emoji.
    for (const key of Object.keys(reactions)) {
      reactions[key] = reactions[key].filter((r) => r.id !== reactor.id);
      if (reactions[key].length === 0) delete reactions[key];
    }
    if (!hadThisEmoji) {
      reactions[emoji] = [...(reactions[emoji] ?? []), reactor];
    }
    txn.update(ref, { reactions });
    return !hadThisEmoji;
  });
}

// Typing flag lifetime — client throttles typing beats to one per ~2.5s,
// so 6s keeps the flag alive between beats without lingering after stop.
export const TYPING_TTL_MS = 6_000;

function presenceRef(code: string, deviceId: string) {
  return roomRef(code).collection('presence').doc(deviceId);
}

/**
 * Heartbeat upsert. `typing` is tri-state on purpose: true sets the flag,
 * false clears it, undefined leaves it alone (plain keep-alive beats must
 * not stomp a typing flag set moments earlier).
 */
export async function upsertPresence(
  code: string,
  input: { device_id: string; name: string; typing?: boolean }
): Promise<void> {
  const patch: Partial<ChatPresence> = {
    device_id: input.device_id,
    name: input.name,
    last_seen: new Date().toISOString(),
  };
  if (input.typing === true) {
    patch.typing_until = new Date(Date.now() + TYPING_TTL_MS).toISOString();
  } else if (input.typing === false) {
    patch.typing_until = null;
  }
  await presenceRef(code, input.device_id).set(patch, { merge: true });
}

/** Remove a presence doc (explicit "Leave room"). */
export async function clearPresence(code: string, deviceId: string): Promise<void> {
  await presenceRef(code, deviceId).delete();
}

/** True when this device has a presence doc beaten within `withinMs`. */
export async function hasFreshPresence(
  code: string,
  deviceId: string,
  withinMs: number
): Promise<boolean> {
  const snap = await presenceRef(code, deviceId).get();
  if (!snap.exists) return false;
  const lastSeen = new Date((snap.data() as ChatPresence).last_seen).getTime();
  return Date.now() - lastSeen < withinMs;
}

// No heartbeat for this long → the participant is announced as "left".
// Clients beat every 25s; background tabs can be throttled to ~1/min, so
// this leaves room for a couple of missed beats. The client's "online" dot
// (ONLINE_WINDOW_MS in features/chat/lib/chat-helpers.ts, 2 min) must stay
// above that ~1/min background beat and at or below this value.
export const PRESENCE_STALE_MS = 3 * 60_000;

/**
 * Heartbeat timeout: delete presence docs that stopped beating and post a
 * "left" notice for each. The delete carries a lastUpdateTime precondition,
 * so a beat that lands mid-sweep (or a second instance sweeping the same
 * room) makes it fail and no duplicate "left" is written.
 */
export async function sweepStalePresence(code: string): Promise<number> {
  const cutoff = new Date(Date.now() - PRESENCE_STALE_MS).toISOString();
  const snap = await roomRef(code)
    .collection('presence')
    .where('last_seen', '<', cutoff)
    .limit(20)
    .get();
  let swept = 0;
  for (const doc of snap.docs) {
    try {
      await doc.ref.delete({ lastUpdateTime: doc.updateTime });
    } catch {
      continue; // beaten or swept by someone else meanwhile
    }
    const p = doc.data() as ChatPresence;
    if (!p.name) continue;
    await addMessage(code, {
      sender_name: p.name,
      sender_id: null,
      sender_device_id: p.device_id,
      content: 'left',
      sender_tz: 'UTC',
      kind: 'system',
    }).catch((err) => console.error(`left notice failed for ${code}:`, err));
    swept++;
  }
  return swept;
}

export async function listRoomsByOwner(uid: string): Promise<ChatRoom[]> {
  const snap = await adminDb()
    .collection(ROOMS_COLLECTION)
    .where('created_by', '==', uid)
    .orderBy('created_at', 'desc')
    .limit(50)
    .get();
  return snap.docs.map((d) => toPublicRoom(d.data() as StoredRoom));
}

/**
 * Delete every expired room: its R2 attachments (by prefix), then its
 * messages subcollection + room doc via Firestore's `recursiveDelete`.
 * Storage goes first so a partial failure can be retried on the next cron
 * tick (the room doc still exists to be found again). Capped at 50 rooms
 * per tick to stay well within a single Vercel function execution.
 */
export async function deleteExpiredRooms(): Promise<number> {
  const nowIso = new Date().toISOString();
  const snap = await adminDb()
    .collection(ROOMS_COLLECTION)
    .where('expires_at', '<', nowIso)
    .limit(50)
    .get();
  if (snap.empty) return 0;
  // recursiveDelete is on the Firestore instance, not on the doc ref.
  const db = adminDb();
  let deleted = 0;
  for (const doc of snap.docs) {
    try {
      await deletePrefix(roomStoragePrefix(doc.id));
      await db.recursiveDelete(doc.ref);
      deleted++;
    } catch (err) {
      console.error(`cleanup failed for room ${doc.id}:`, err);
    }
  }
  return deleted;
}
