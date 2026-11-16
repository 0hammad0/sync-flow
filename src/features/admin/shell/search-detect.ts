import { normaliseIp } from '@/shared/lib/ip';
import { ROOM_CODE_PATTERN, normaliseRoomCode } from '@/features/admin/rooms/constants';

// What a command-palette query looks like (16-command-palette.md "Search").
// Pure and zod-free: the palette (client) uses it to decide whether a server
// call is worth making, and searchAdmin (server) uses it to pick lookups.
// Every shape is exact, so each needs at most one point read (32 hex: two).

export const SEARCH_MIN = 2;
export const SEARCH_MAX = 100;

export type QueryShape =
  | { kind: 'ip'; ip: string }
  /** A dotted quad or IPv6 that is not complete yet: no lookup, a hint. */
  | { kind: 'partial-ip'; family: 4 | 6 }
  | { kind: 'email'; email: string }
  | { kind: 'uid'; uid: string }
  | { kind: 'room'; code: string }
  /** 32 hex: a share token and a session id look the same, so both are tried. */
  | { kind: 'hex32'; value: string }
  | { kind: 'block-ref'; ref: string }
  /** Anything else: pages and actions are filtered on the client only (no file-name search, D-6). */
  | { kind: 'text' };

/** Firebase email-link uids are 28 characters (same rule as the sessions search). */
const UID_RE = /^[A-Za-z0-9]{28}$/;
const HEX32_RE = /^[0-9a-f]{32}$/i;
const BLOCK_REF_RE = /^[A-Z0-9]{6}-\d{10}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PARTIAL_V4_RE = /^\d{1,3}(\.\d{1,3}){1,3}\.?$/;
const PARTIAL_V6_RE = /^[0-9a-f:]+$/i;

export function detectQuery(raw: string): QueryShape {
  const q = raw.trim();
  if (q.length < SEARCH_MIN || q.length > SEARCH_MAX) return { kind: 'text' };

  const ip = normaliseIp(q);
  if (ip) return { kind: 'ip', ip };
  if (PARTIAL_V4_RE.test(q)) return { kind: 'partial-ip', family: 4 };
  if (q.includes(':') && PARTIAL_V6_RE.test(q)) return { kind: 'partial-ip', family: 6 };

  if (q.includes('@')) return EMAIL_RE.test(q) ? { kind: 'email', email: q.toLowerCase() } : { kind: 'text' };
  if (HEX32_RE.test(q)) return { kind: 'hex32', value: q.toLowerCase() };
  if (BLOCK_REF_RE.test(q)) return { kind: 'block-ref', ref: q.toUpperCase() };
  if (UID_RE.test(q)) return { kind: 'uid', uid: q };

  const code = normaliseRoomCode(q);
  if (ROOM_CODE_PATTERN.test(code)) return { kind: 'room', code };
  return { kind: 'text' };
}

/** True when the server has something to look up for this shape. */
export function needsServer(shape: QueryShape): boolean {
  return shape.kind !== 'text' && shape.kind !== 'partial-ip';
}
