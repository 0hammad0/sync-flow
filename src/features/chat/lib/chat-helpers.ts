// Shared pure helpers and constants for the chat feature. Kept dependency-
// light so ChatRoom, MessageBubble, and MediaViewer can all import them
// without pulling in each other.

import type { User } from 'firebase/auth';
import type { ChatAttachment, ChatMessage, ChatReactor } from '@/types';
import { normalizeReactors } from '@/shared/lib/utils';
import { MAX_UPLOAD_BYTES } from '@/shared/lib/limits';

// Album limit lives in shared utils (server enforces the same value); re-export
// so chat components can keep importing it from one place.
export { MAX_ALBUM_FILES } from '@/shared/lib/utils';

// Mirror of the server's toggleReaction transaction (firebase/chat.ts) so the
// UI can apply a reaction optimistically and match the value the snapshot will
// later confirm: one reaction per device — a new emoji moves your reaction,
// the same emoji removes it.
export function toggleReactionLocal(
  raw: ChatMessage['reactions'],
  emoji: string,
  reactor: ChatReactor
): Record<string, ChatReactor[]> {
  const reactions: Record<string, ChatReactor[]> = {};
  const source = (raw ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    reactions[key] = normalizeReactors(source[key]);
  }
  const hadThisEmoji = (reactions[emoji] ?? []).some((r) => r.id === reactor.id);
  // Drop this device's reaction from every emoji first.
  for (const key of Object.keys(reactions)) {
    reactions[key] = reactions[key].filter((r) => r.id !== reactor.id);
    if (reactions[key].length === 0) delete reactions[key];
  }
  if (!hadThisEmoji) {
    reactions[emoji] = [...(reactions[emoji] ?? []), reactor];
  }
  return reactions;
}

export const STORED_NAME_KEY = 'syncflow.chatName';
export const DEVICE_ID_KEY = 'syncflow.deviceId';
export const SOUND_KEY = 'syncflow.chatSound'; // '1' = beep on new messages
export const NOTIFY_KEY = 'syncflow.chatNotify'; // '1' = browser notifications
export const RECENT_ROOMS_KEY = 'syncflow.recentRooms';
export const MAX_RECENT_ROOMS = 10;

export const MAX_ATTACHMENT_BYTES = MAX_UPLOAD_BYTES; // same cap the server enforces
export const LARGE_MESSAGE_THRESHOLD = 4_000;
export const MESSAGES_WINDOW = 500;
// Messages this long (or code snippets) get an explicit copy control.
export const COPYABLE_TEXT_THRESHOLD = 240;

// Presence cadence — chosen so cost stays trivial: one tiny write per 25s
// per participant, plus at most one typing write per 2.5s WHILE typing.
export const HEARTBEAT_MS = 25_000;
export const TYPING_THROTTLE_MS = 2_500;
// Shown as online when the last beat is newer than this. Background tabs get
// throttled to ~1 beat/min, so 2 min avoids flicker; keep it at or below the
// server's PRESENCE_STALE_MS (3 min, shared/lib/firebase/chat.ts), after which
// the participant is announced as "left".
export const ONLINE_WINDOW_MS = 2 * 60_000;

// Curated quick-picker set (the textarea also accepts any emoji from the
// OS keyboard). Defined in shared utils because the reactions route
// validates the reaction "+" picker against it.
export { EMOJI_SET } from '@/shared/lib/utils';

// Composer rewrite presets — the client sends only the preset id; the
// server owns the instruction text.
export { REWRITE_PRESETS as REWRITE_OPTIONS } from '@/features/ai/lib/rewrite-presets';

// Stable per-device id so "is this mine" doesn't depend on display names
// (two people can pick the same name). Survives reloads via localStorage;
// falls back to a per-tab id when storage is blocked.
let memoryDeviceId: string | null = null;
export function getDeviceId(): string {
  if (memoryDeviceId) return memoryDeviceId;
  const mint = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  try {
    let id = window.localStorage.getItem(DEVICE_ID_KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = mint();
      window.localStorage.setItem(DEVICE_ID_KEY, id);
    }
    memoryDeviceId = id;
  } catch {
    memoryDeviceId = mint();
  }
  return memoryDeviceId;
}

// Public form of the device id: the first 32 hex chars of sha256(raw id).
// The raw id stays secret in this browser and is sent only to our server;
// messages, presence and reactions store this hash, so "is this mine"
// compares against it. Must match deviceKey() in shared/lib/firebase/chat.ts.
// Plain JS (not crypto.subtle) so it is synchronous and also works on
// non-HTTPS origins such as a LAN IP.
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function deviceIdHash(raw: string): string {
  const msg = new TextEncoder().encode(raw);
  const bitLen = msg.length * 8;
  const padded = new Uint8Array((((msg.length + 9 + 63) >> 6) << 6));
  padded.set(msg);
  padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i];
      const t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d;
    h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('').slice(0, 32);
}

// What the in-chat viewer can render. Anything else falls back to download.
export function previewKind(att: ChatAttachment): 'image' | 'pdf' | 'docx' | null {
  const mime = att.mime_type || '';
  const name = (att.name || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx')
  ) {
    return 'docx';
  }
  return null;
}

export function attachmentViewUrl(roomCode: string, key: string): string {
  return `/api/chat/${roomCode}/attachments?key=${encodeURIComponent(key)}`;
}

// Same endpoint, signed as `attachment` and saved under the original name.
export function attachmentDownloadUrl(roomCode: string, att: ChatAttachment): string {
  return `${attachmentViewUrl(roomCode, att.key)}&download=1&name=${encodeURIComponent(att.name)}`;
}

// All attachments of a message — album field first, legacy single fallback.
export function getAtts(m: ChatMessage): ChatAttachment[] {
  if (m.attachments?.length) return m.attachments;
  return m.attachment ? [m.attachment] : [];
}

// Emoji-only messages render extra large with a pop animation (WhatsApp-style).
export function isEmojiOnly(content: string): boolean {
  const t = content.replace(/\s/g, '');
  if (!t || t.length > 16) return false;
  if (!/\p{Extended_Pictographic}/u.test(t)) return false;
  return /^[\p{Extended_Pictographic}\p{Emoji_Component}‍️]+$/u.test(t);
}

export function nameForUser(user: User | null): string {
  if (!user?.email) return '';
  return user.email.split('@')[0];
}

export function byteLen(s: string): number {
  // TextEncoder is fast and accurate.
  return new TextEncoder().encode(s).length;
}

/* ------------------------- storage-safe helpers ------------------------- */

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked — the setting just won't persist */
  }
}

// Default display name for someone who hasn't picked one: the email prefix
// when signed in, otherwise "Guest-XXXX" (no I/O/0/1 to avoid misreads).
export function guestName(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return `Guest-${out}`;
}

// Phones/tablets: no hover, Enter inserts a newline, long-press for actions.
export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

/* ------------------------------ recent rooms ----------------------------- */

export interface RecentRoom {
  code: string;
  name: string | null;
  expires_at: string;
  visited_at: string;
}

export function parseRecent(raw: string | null): RecentRoom[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter(
      (r): r is RecentRoom =>
        r && typeof r.code === 'string' && typeof r.expires_at === 'string'
    );
  } catch {
    return [];
  }
}

/** Remember a visited room (newest first, deduped, capped, expired dropped). */
export function rememberRoom(room: { code: string; name: string | null; expires_at: string }): void {
  const now = Date.now();
  const rest = parseRecent(readStorage(RECENT_ROOMS_KEY)).filter(
    (r) => r.code !== room.code && new Date(r.expires_at).getTime() > now
  );
  const next: RecentRoom[] = [
    { code: room.code, name: room.name, expires_at: room.expires_at, visited_at: new Date(now).toISOString() },
    ...rest,
  ].slice(0, MAX_RECENT_ROOMS);
  writeStorage(RECENT_ROOMS_KEY, JSON.stringify(next));
}

export function forgetRoom(code: string): void {
  const rest = parseRecent(readStorage(RECENT_ROOMS_KEY)).filter((r) => r.code !== code);
  writeStorage(RECENT_ROOMS_KEY, JSON.stringify(rest));
}

/* ------------------------------ error copy ------------------------------- */

// Raw codes the chat API returns → one plain sentence for the user. Every
// chat error shown in the UI goes through friendlyError().
const ERROR_COPY: Record<string, string> = {
  expired: 'This room has expired.',
  not_found: 'This room no longer exists.',
  invalid_code: 'That room code is not valid.',
  unexpected: 'Something went wrong on our side. Please try again.',
  reply_target_not_found: 'The message you replied to is gone. Send it without the reply.',
  'senderName empty': 'Pick a display name first.',
  'senderName required': 'Pick a display name first.',
  'invalid replyToId': 'The message you replied to is gone. Send it without the reply.',
  'content empty': 'Type a message first.',
  'invalid attachments': 'Those files could not be attached. Upload them again.',
  message_not_found: 'That message is gone.',
  cannot_react_to_system: 'You can\'t react to that.',
  rate_limited: 'Slow down a little and try again in a moment.',
  not_signed_in: 'Sign in to extend this room.',
  not_owner: 'Only the person who created this room can extend it.',
  anonymous_room: 'This room was created without signing in, so it can\'t be extended.',
  at_max: 'This room is already at its 7-day maximum.',
};

/**
 * Turn whatever a chat request failed with (server code, HTTP status, or a
 * thrown Error) into a short sentence. Server messages that are already
 * sentences pass through unchanged.
 */
export function friendlyError(raw: unknown, status?: number): string {
  if (status === 429) return 'You\'re going too fast. Wait a moment and try again.';
  const text =
    raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : '';
  if (text && ERROR_COPY[text]) return ERROR_COPY[text];
  if (/^HTTP 5\d\d$/.test(text) || (status !== undefined && status >= 500)) {
    return ERROR_COPY.unexpected;
  }
  if (/failed to fetch|networkerror|load failed/i.test(text)) {
    return 'Network error. Check your connection and try again.';
  }
  // Already a readable sentence (starts upper-case, has a space).
  if (text && /^[A-Z"“]/.test(text) && text.includes(' ')) return text;
  return 'Something went wrong. Please try again.';
}

/* --------------------------------- sound --------------------------------- */

let audioCtx: AudioContext | null = null;

/** Short, soft two-tone beep via WebAudio — no asset to load. */
export function playBeep(): void {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.setValueAtTime(1175, t + 0.09);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.26);
  } catch {
    /* audio blocked — silent is fine */
  }
}
