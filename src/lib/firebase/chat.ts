import { adminDb } from './admin';
import { generateRoomCode, normalizeReactors } from '@/lib/utils';
import { deletePrefix } from '@/lib/r2';
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
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024; // same cap as file sharing
export const ALLOWED_TTL_HOURS: ReadonlyArray<1 | 24 | 168> = [1, 24, 168];

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
      await roomRef(code).create(doc);
      return doc;
    } catch (err: unknown) {
      // Firestore "ALREADY_EXISTS" → retry with a fresh code.
      const code9 = (err as { code?: number })?.code === 6;
      const msgHasExists = /already exists/i.test(
        (err as { message?: string })?.message || ''
      );
      if (!code9 && !msgHasExists) throw err;
    }
  }
  throw new Error('Failed to generate a unique room code after 5 attempts');
}

export async function getRoom(code: string): Promise<ChatRoom | null> {
  const snap = await roomRef(code).get();
  if (!snap.exists) return null;
  return snap.data() as ChatRoom;
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
  }
): Promise<ChatMessage> {
  if (Buffer.byteLength(input.content, 'utf8') > MAX_MESSAGE_BYTES) {
    throw new Error(`Message exceeds ${MAX_MESSAGE_BYTES} bytes`);
  }
  const docRef = messagesRef(code).doc();
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
  await docRef.set(message);
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
  const snippet = target.content
    ? target.content.slice(0, 120)
    : atts.length > 1
      ? `${atts[0].name} +${atts.length - 1} more`
      : (atts[0]?.name ?? '');
  return { id: target.id, sender_name: target.sender_name, snippet, attachment_kind };
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

/** Remove a presence doc (sent via beacon when the tab closes). */
export async function clearPresence(code: string, deviceId: string): Promise<void> {
  await presenceRef(code, deviceId).delete();
}

export async function listRoomsByOwner(uid: string): Promise<ChatRoom[]> {
  const snap = await adminDb()
    .collection(ROOMS_COLLECTION)
    .where('created_by', '==', uid)
    .orderBy('created_at', 'desc')
    .limit(50)
    .get();
  return snap.docs.map((d) => d.data() as ChatRoom);
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
