import { randomBytes } from 'crypto';

// Constants
export const MAX_USER_FILES = 10;

export function generateToken(): string {
  return randomBytes(16).toString('hex');
}

// 30 chars, no I O 0 1 L (ambiguous when shared verbally or by QR)
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 8;

// Cryptographically-random room code from a human-friendly alphabet.
// 30^8 ≈ 6.56e11 combos — safe for short-lived rooms.
export function generateRoomCode(): string {
  const buf = randomBytes(ROOM_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ROOM_CODE_ALPHABET[buf[i] % ROOM_CODE_ALPHABET.length];
  }
  return out;
}

export function isValidRoomCode(code: string): boolean {
  if (typeof code !== 'string' || code.length !== ROOM_CODE_LENGTH) return false;
  for (let i = 0; i < code.length; i++) {
    if (!ROOM_CODE_ALPHABET.includes(code[i])) return false;
  }
  return true;
}

// WhatsApp's six quick reactions. Shared between the picker UI and the
// server-side validation in /api/chat/[roomCode]/reactions.
export const CHAT_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

// Long text messages: over INLINE the client transparently stores the body
// in R2 (Firestore docs cap at 1MB and big docs slow every listener);
// 15MB is the hard ceiling. Both shared client+server.
export const INLINE_TEXT_BYTES = 100_000;
export const MAX_LONG_TEXT_BYTES = 15 * 1024 * 1024;
export const LONG_TEXT_PREVIEW_CHARS = 500;

// Per-device id: URL-safe, browser-minted (crypto.randomUUID or fallback).
export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function sanitizeDeviceId(raw: unknown): string | null {
  return typeof raw === 'string' && DEVICE_ID_RE.test(raw) ? raw : null;
}

/**
 * Reaction lists written before per-device ids were plain name strings.
 * Upgrade them to {id, name} on read so old and new entries coexist;
 * legacy entries get a name-derived id (same collision behavior as before).
 */
export function normalizeReactors(
  list: unknown
): { id: string; name: string }[] {
  if (!Array.isArray(list)) return [];
  const out: { id: string; name: string }[] = [];
  for (const entry of list) {
    if (typeof entry === 'string') {
      out.push({ id: `legacy:${entry}`, name: entry });
    } else if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { id?: unknown }).id === 'string' &&
      typeof (entry as { name?: unknown }).name === 'string'
    ) {
      out.push({ id: (entry as { id: string }).id, name: (entry as { name: string }).name });
    }
  }
  return out;
}

// Loose IANA timezone validation — checks shape, not real existence.
// e.g. "Asia/Karachi", "America/Los_Angeles", "UTC". Falls back to "UTC".
const IANA_RE = /^[A-Za-z]+(?:\/[A-Za-z_+-]+){0,2}$/;
export function sanitizeIanaTz(tz: unknown): string {
  if (typeof tz !== 'string' || tz.length > 64 || !IANA_RE.test(tz)) return 'UTC';
  return tz;
}

export function sanitizeFileName(fileName: string): string {
  // Remove or replace characters that are problematic for file systems/URLs
  return fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 255);
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getBaseUrl(): string {
  // First check explicit app URL (works on both client and server)
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  }

  // Server-side: use Vercel URL
  if (typeof window === 'undefined') {
    if (process.env.VERCEL_URL) {
      return `https://${process.env.VERCEL_URL}`;
    }
    return 'http://localhost:3000';
  }

  // Client-side: use current origin
  return window.location.origin;
}

// Origin for URLs that must be reachable from OTHER devices (QR codes, share links).
// Server-side getBaseUrl() falls back to localhost, which is useless inside a QR code —
// instead, derive the origin from the request the browser actually made (LAN IP in dev,
// real domain behind a proxy via x-forwarded-*). NEXT_PUBLIC_APP_URL still wins when set.
export function getRequestOrigin(headers: Headers): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  }
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (host) {
    const proto =
      headers.get('x-forwarded-proto') ??
      (host.startsWith('localhost') || host.startsWith('127.') || /^\d+\.\d+\.\d+\.\d+/.test(host)
        ? 'http'
        : 'https');
    return `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}`;
  }
  return getBaseUrl();
}
