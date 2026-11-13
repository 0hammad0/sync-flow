import { z } from 'zod';
import type { SessionFilter } from '@/server/repositories/interfaces';
import { normaliseIp } from '@/shared/lib/ip';
import {
  FILTER_KEYS,
  MAX_CURSOR_DEPTH,
  SESSION_DEVICES,
  type FilterKey,
  type SearchProblem,
  type SessionDevice,
} from './constants';

export * from './constants';

// URL state of /admin/sessions (04-sessions.md "Data → Table"), shared by the
// server page, the table (client) and the sessions CSV export. Never throws:
// anything unusable is dropped and the screen falls back to "no filter".
//
// Keys: `q` (search: full IP or user id), `country`, `device`, `cursor`, plus
// the shared `range` / `from` / `to` (range-schema.ts). Only ONE of q,
// country, device applies: each needs its own composite index. A hand-made
// URL with more keeps the first in that order and says so.

export type SessionsFilter =
  | { kind: 'country'; value: string }
  | { kind: 'device'; value: SessionDevice }
  | { kind: 'user'; value: string }
  /** Exact IP: any date, newest 100, no paging. Roles with `ip:read` only. */
  | { kind: 'ip'; value: string };

const CURSOR_PART = /^[A-Za-z0-9_-]{1,200}$/;
/** Firebase email-link uids are 28 characters (same rule as the sessions CSV export). */
const UID_RE = /^[A-Za-z0-9]{28}$/;
const CURSOR_SEPARATOR = '.';

export type SessionsParams = {
  filter: SessionsFilter | null;
  /** Search text as typed (trimmed), '' when none. */
  q: string;
  searchProblem: SearchProblem | null;
  /** Filters in the URL that were ignored because another one came first. */
  ignored: FilterKey[];
  /** Cursors of every page from the second to this one, oldest first. `[]` = first page. */
  cursorStack: string[];
};

const first = z.unknown().transform((v): unknown => (Array.isArray(v) ? v[0] : v));
const text = (max: number) => first.transform((v) => (typeof v === 'string' ? v.trim().slice(0, max) : ''));

const rawSchema = z.object({
  q: text(200),
  country: text(8)
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/))
    .catch(''),
  device: text(16).pipe(z.enum(SESSION_DEVICES).or(z.literal(''))).catch(''),
  cursor: text(MAX_CURSOR_DEPTH * 210),
});

function withKeys(input: unknown): Record<'q' | 'country' | 'device' | 'cursor', unknown> {
  const s = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return { q: s.q ?? '', country: s.country ?? '', device: s.device ?? '', cursor: s.cursor ?? '' };
}

/** `a.b.c` → `['a','b','c']`. Any bad part → first page. Too deep → the newest `MAX_CURSOR_DEPTH`. */
export function parseCursorStack(value: string | null | undefined): string[] {
  if (!value) return [];
  const parts = value.split(CURSOR_SEPARATOR);
  if (!parts.every((p) => CURSOR_PART.test(p))) return [];
  return parts.slice(-MAX_CURSOR_DEPTH);
}

export function serializeCursorStack(stack: readonly string[]): string {
  return stack.slice(-MAX_CURSOR_DEPTH).join(CURSOR_SEPARATOR);
}

/** The search box: full IP (with `ip:read`) or a user id. */
export function parseSearch(q: string, canSeeIp: boolean): { filter: SessionsFilter | null; problem: SearchProblem | null } {
  if (!q) return { filter: null, problem: null };
  const ip = normaliseIp(q);
  if (ip) return canSeeIp ? { filter: { kind: 'ip', value: ip }, problem: null } : { filter: null, problem: 'ip_not_allowed' };
  if (UID_RE.test(q)) return { filter: { kind: 'user', value: q }, problem: null };
  return { filter: null, problem: 'invalid' };
}

/** Next.js `searchParams` → the one filter and the page cursor for /admin/sessions. */
export function parseSessionsParams(
  search: Record<string, string | string[] | undefined> | null | undefined,
  access: { canSeeIp: boolean },
): SessionsParams {
  const raw = rawSchema.parse(withKeys(search));
  const searched = parseSearch(raw.q, access.canSeeIp);
  // Only usable values count: a bad search does not hide a good country filter.
  const values: Record<FilterKey, SessionsFilter | null> = {
    q: searched.filter,
    country: raw.country ? { kind: 'country', value: raw.country } : null,
    device: raw.device ? { kind: 'device', value: raw.device } : null,
  };
  const present = FILTER_KEYS.filter((key) => values[key] !== null);
  const [chosen, ...ignored] = present;
  const filter = chosen ? values[chosen] : null;
  return {
    filter,
    q: raw.q,
    searchProblem: searched.problem,
    ignored,
    // IP search is one list of ≤ 100 rows: no pages.
    cursorStack: filter?.kind === 'ip' ? [] : parseCursorStack(raw.cursor),
  };
}

/** The repository filter for a range query. IP search goes through `ip` instead. */
export function toSessionFilter(filter: SessionsFilter | null): SessionFilter | null {
  if (!filter) return null;
  switch (filter.kind) {
    case 'country':
      return { field: 'country', value: filter.value };
    case 'device':
      return { field: 'device', value: filter.value };
    case 'user':
      return { field: 'user_id', value: filter.value };
    case 'ip':
      return null;
  }
}

/**
 * Newer / Older links for a forward-only cursor. The `cursor` param holds
 * the whole trail, so Newer is the trail minus its last step, and reload or
 * Back lands on the same page. `prevCursor: ''` is DataTable's "first page".
 */
export function pageCursors(stack: readonly string[], nextCursor: string | null): {
  cursor: string | null;
  prevCursor: string | null;
  nextCursor: string | null;
} {
  return {
    cursor: stack.at(-1) ?? null,
    prevCursor: stack.length === 0 ? null : serializeCursorStack(stack.slice(0, -1)),
    nextCursor: nextCursor ? serializeCursorStack([...stack, nextCursor]) : null,
  };
}
