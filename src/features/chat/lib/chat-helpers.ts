// Shared pure helpers and constants for the chat feature. Kept dependency-
// light so ChatRoom, MessageBubble, and MediaViewer can all import them
// without pulling in each other.

import type { User } from 'firebase/auth';
import type { ChatAttachment, ChatMessage } from '@/types';

export const STORED_NAME_KEY = 'syncflow.chatName';
export const DEVICE_ID_KEY = 'syncflow.deviceId';

export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const LARGE_MESSAGE_THRESHOLD = 4_000;
export const MESSAGES_WINDOW = 500;
export const MAX_ALBUM_FILES = 10;
// Messages this long (or code snippets) get an explicit copy control.
export const COPYABLE_TEXT_THRESHOLD = 240;

// Presence cadence — chosen so cost stays trivial: one tiny write per 25s
// per participant, plus at most one typing write per 2.5s WHILE typing.
export const HEARTBEAT_MS = 25_000;
export const TYPING_THROTTLE_MS = 2_500;
export const ONLINE_WINDOW_MS = 60_000;

// Curated quick-picker set — the textarea also accepts any emoji from the
// OS keyboard (Win+. / Cmd+Ctrl+Space).
export const EMOJI_SET = [
  '😀', '😂', '🤣', '😊', '😍', '😘', '😎', '🤩',
  '🥳', '😅', '😉', '🙃', '😢', '😭', '😡', '🤔',
  '🤗', '🤫', '😴', '🥺', '👍', '👎', '👏', '🙏',
  '🤝', '💪', '✌️', '🤞', '❤️', '🧡', '💛', '💚',
  '💙', '💜', '🖤', '💔', '🔥', '✨', '🎉', '🎂',
  '🌹', '☀️', '🌙', '⭐', '⚡', '💯', '✅', '❌',
];

// Composer rewrite presets — sent verbatim as the AI instruction.
export const REWRITE_OPTIONS = [
  { label: 'Shorter', instruction: 'Make it shorter and punchier' },
  { label: 'Friendlier', instruction: 'Make it warmer and friendlier' },
  { label: 'Professional', instruction: 'Make it polished and professional' },
  { label: 'Fix grammar', instruction: 'Fix grammar, spelling, and punctuation without changing the meaning or tone' },
  { label: '→ English', instruction: 'Translate it to English' },
] as const;

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
