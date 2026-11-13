import { ROUTE_PATTERNS, type RoutePattern } from './routes';

/**
 * Pure helpers shared by the client tracker and the server ingest.
 * No imports beyond the route list, so the tracker chunk stays tiny.
 */

const MAX_INPUT = 2048;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;
const UTM_MAX = 100;

export type UtmKey = (typeof UTM_KEYS)[number];
export type Utm = Partial<Record<UtmKey, string>>;

type CompiledPattern = { pattern: RoutePattern; segments: { value: string; dynamic: boolean }[] };

const COMPILED: CompiledPattern[] = ROUTE_PATTERNS.map((pattern) => ({
  pattern,
  segments: pattern
    .split('/')
    .filter(Boolean)
    .map((value) => ({ value, dynamic: value.startsWith('[') })),
}));

/** Path part of a path or absolute URL, without query string or hash. */
function pathOnly(raw: string): string | null {
  let path = raw;
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  const cut = path.search(/[?#]/);
  if (cut !== -1) path = path.slice(0, cut);
  return path.startsWith('/') ? path : null;
}

/**
 * Maps a visited path to its route pattern, or `null` when it is not a known
 * public page. Query strings and hashes are always dropped; dynamic segments
 * become labels, so `/chat/AB12CD` → `/chat/[code]` and
 * `/share/x?y=1` → `/share/[token]`. `null` means "do not record".
 */
export function normalisePath(raw: unknown): RoutePattern | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_INPUT) return null;
  const path = pathOnly(raw);
  if (path === null) return null;
  const parts = path.split('/').filter(Boolean);

  for (const { pattern, segments } of COMPILED) {
    if (segments.length !== parts.length) continue;
    if (segments.every((s, i) => s.dynamic || s.value === parts[i])) return pattern;
  }
  return null;
}

/** Control characters (C0, DEL, C1). */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/** `utm_source`, `utm_medium` and `utm_campaign` from a query string. Every other parameter is dropped. */
export function utmFromSearch(search: string): Utm {
  const out: Utm = {};
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return out;
  }
  for (const key of UTM_KEYS) {
    const value = params.get(key)?.replace(CONTROL_CHARS, '').trim().slice(0, UTM_MAX);
    if (value) out[key] = value;
  }
  return out;
}

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

/** Referrer reduced to its host name (`https://news.example.com/a?b` → `news.example.com`), or null. */
export function referrerHost(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_INPUT) return null;
  let host = raw.trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(host)) {
    try {
      host = new URL(host).hostname;
    } catch {
      return null;
    }
  } else {
    host = host.split(/[/?#:]/)[0];
  }
  host = host.replace(/\.$/, '');
  return HOSTNAME.test(host) ? host : null;
}
