import 'server-only';

import { encodeKey, FOLD_KEY } from '@/server/firestore/encode-key';

/**
 * Analytics documents (`a_sessions`, `a_hourly`, `a_daily`) and the pure
 * maths on them. Shared by the Firestore and in-memory EventRepository, the
 * ingest and the rollup cron, so all of them agree on one meaning.
 * Spec: docs/admin/01-architecture/03-data-model.md.
 */

// ---------------------------------------------------------------------------
// Settings (admin_config/settings)
// ---------------------------------------------------------------------------

export type TrackingSettings = {
  /** Kill switch. A missing doc or field means OFF. */
  trackingEnabled: boolean;
  /** Full IP kept this many days after the session was last seen, then nulled. */
  ipRetentionDays: number;
  /** `a_sessions` kept this many days after last seen, then deleted. */
  rawRetentionDays: number;
};

/** Code defaults. `admin_config/settings` is not created by phase 2: missing = these. */
export const DEFAULT_TRACKING_SETTINGS: Readonly<TrackingSettings> = {
  trackingEnabled: false,
  ipRetentionDays: 30,
  rawRetentionDays: 90,
};

// ---------------------------------------------------------------------------
// a_sessions/{sid}
// ---------------------------------------------------------------------------

export type Device = 'mobile' | 'tablet' | 'desktop';

/**
 * One page view inside a session, keyed by the tracker's page-view id.
 * A map (not an array) so every flush can add engaged time to an earlier page
 * with `FieldValue.increment`, without reading the doc first.
 */
export type PageEntry = {
  /** Normalised pattern (`/chat/[code]`); null if the pageview event never arrived. */
  path: string | null;
  ts: Date | null;
  engaged_ms: number;
  /** 0, 25, 50, 75 or 100. */
  scroll_max: number;
};

export type Vitals = { lcp: number | null; inp: number | null; cls: number | null };

export type SessionDoc = {
  id: string;
  started_at: Date | null;
  last_seen_at: Date;
  ip: string | null;
  ip_trunc: string | null;
  /** Mode B (light) only: daily-salted hash instead of the IP. */
  ip_hash: string | null;
  /** True while `ip` holds a full address; the retention cron nulls it and sets false. */
  ip_held: boolean;
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  tz: string | null;
  browser: string | null;
  browser_version: string | null;
  os: string | null;
  device: Device | null;
  viewport_w: number | null;
  viewport_h: number | null;
  referrer_host: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  entry_path: string | null;
  exit_path: string | null;
  pageviews: number;
  engaged_ms: number;
  user_id: string | null;
  device_hash: string | null;
  rolled_up: boolean;
  sampled: boolean;
  pages: Record<string, PageEntry>;
  vitals: Vitals | null;
};

/** Plain fields a flush may overwrite. */
export type SessionSetFields = Partial<
  Omit<SessionDoc, 'id' | 'last_seen_at' | 'pageviews' | 'engaged_ms' | 'pages'>
>;

/** A page entry change: `engaged_ms` is added, the others overwrite when present. */
export type PagePatch = { path?: string; ts?: Date; engaged_ms: number; scroll_max?: number };

/**
 * Everything one tracker flush changes on its session doc. Written as ONE
 * `set(…, { merge: true })`: plain fields overwrite, counters increment,
 * page entries merge.
 */
export type SessionPatch = {
  id: string;
  /** Becomes `last_seen_at`. */
  now: Date;
  set: SessionSetFields;
  increment: { pageviews: number; engaged_ms: number };
  pages: Record<string, PagePatch>;
};

export function emptySession(id: string, now: Date): SessionDoc {
  return {
    id,
    started_at: null,
    last_seen_at: now,
    ip: null,
    ip_trunc: null,
    ip_hash: null,
    ip_held: false,
    country: null,
    region: null,
    city: null,
    lat: null,
    lon: null,
    tz: null,
    browser: null,
    browser_version: null,
    os: null,
    device: null,
    viewport_w: null,
    viewport_h: null,
    referrer_host: null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    entry_path: null,
    exit_path: null,
    pageviews: 0,
    engaged_ms: 0,
    user_id: null,
    device_hash: null,
    rolled_up: false,
    sampled: false,
    pages: {},
    vitals: null,
  };
}

/** What Firestore's merge does with a patch, in memory. Used by the final flush and the in-memory repo. */
export function applySessionPatch(doc: SessionDoc | null, patch: SessionPatch): SessionDoc {
  const base = doc ? structuredClone(doc) : emptySession(patch.id, patch.now);
  const next: SessionDoc = { ...base, last_seen_at: patch.now };
  for (const [key, value] of Object.entries(patch.set) as [keyof SessionSetFields, unknown][]) {
    if (value !== undefined) (next as Record<string, unknown>)[key] = structuredClone(value);
  }
  next.pageviews += patch.increment.pageviews;
  next.engaged_ms += patch.increment.engaged_ms;
  for (const [pv, change] of Object.entries(patch.pages)) {
    const page = next.pages[pv] ?? { path: null, ts: null, engaged_ms: 0, scroll_max: 0 };
    next.pages[pv] = {
      path: change.path ?? page.path,
      ts: change.ts ?? page.ts,
      engaged_ms: page.engaged_ms + change.engaged_ms,
      scroll_max: change.scroll_max ?? page.scroll_max,
    };
  }
  return next;
}

// ---------------------------------------------------------------------------
// a_hourly/{YYYY-MM-DD-HH} and a_daily/{YYYY-MM-DD}
// ---------------------------------------------------------------------------

export type DimStats = { sessions: number; views: number; engaged_ms: number; bounces: number };
export type PathStats = {
  views: number;
  sessions: number;
  engaged_ms: number;
  bounces: number;
  entries: number;
  exits: number;
  scroll_sum: number;
};
export type CityStats = DimStats & { lat: number | null; lon: number | null };

/** Breakdown maps with `DimStats` values. `path` and `city` have their own shapes. */
export const DIM_MAPS = [
  'country',
  'region',
  'device',
  'browser',
  'os',
  'referrer',
  'utm_source',
  'utm_medium',
  'utm_campaign',
] as const;
export type DimMap = (typeof DIM_MAPS)[number];

/** Every map field on a rollup doc (index-exempt in firestore.indexes.json). */
export const ROLLUP_MAP_FIELDS = ['path', 'city', ...DIM_MAPS] as const;

export type Rollup = {
  views: number;
  sessions: number;
  bounces: number;
  engaged_ms: number;
  /** True if any counted session was sampled (its counts are ×2). */
  sampled: boolean;
  path: Record<string, PathStats>;
  city: Record<string, CityStats>;
} & Record<DimMap, Record<string, DimStats>>;

export type DailyDoc = Rollup & { day: string; built_at: Date };

export function emptyRollup(): Rollup {
  const r = { views: 0, sessions: 0, bounces: 0, engaged_ms: 0, sampled: false, path: {}, city: {} } as Rollup;
  for (const m of DIM_MAPS) r[m] = {};
  return r;
}

function emptyDim(): DimStats {
  return { sessions: 0, views: 0, engaged_ms: 0, bounces: 0 };
}

function emptyPath(): PathStats {
  return { views: 0, sessions: 0, engaged_ms: 0, bounces: 0, entries: 0, exits: 0, scroll_sum: 0 };
}

/** `a_hourly` doc id for an instant (UTC), e.g. `2026-11-13-07`. */
export function hourKey(at: Date): string {
  return at.toISOString().slice(0, 13).replace('T', '-');
}

/** UTC day of an instant, e.g. `2026-11-13`. */
export function dayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** The 24 `a_hourly` ids of a UTC day. */
export function hoursOfDay(day: string): string[] {
  return Array.from({ length: 24 }, (_, h) => `${day}-${String(h).padStart(2, '0')}`);
}

/** Pages of a session that have a path, oldest first. */
function viewedPages(session: SessionDoc): PageEntry[] {
  return Object.values(session.pages)
    .filter((p) => p.path !== null)
    .sort((a, b) => (a.ts?.getTime() ?? 0) - (b.ts?.getTime() ?? 0));
}

/** The hour a session is counted in: its start, else its first page, else when it was last seen. */
export function rollupHour(session: SessionDoc): string {
  const first = viewedPages(session)[0]?.ts ?? null;
  return hourKey(session.started_at ?? first ?? session.last_seen_at);
}

/**
 * One session's contribution to its hour. A sampled session counts twice
 * (1 in 2 sessions kept). A session with no recorded page view adds nothing.
 * Bounce = exactly one page view.
 */
export function sessionRollup(session: SessionDoc): Rollup {
  const r = emptyRollup();
  const pages = viewedPages(session);
  if (pages.length === 0) return r;

  const k = session.sampled ? 2 : 1;
  const views = pages.length;
  const engaged = pages.reduce((sum, p) => sum + p.engaged_ms, 0);
  const bounce = views === 1 ? 1 : 0;

  r.sessions = k;
  r.views = views * k;
  r.engaged_ms = engaged * k;
  r.bounces = bounce * k;
  r.sampled = session.sampled;

  const seenPaths = new Set<string>();
  pages.forEach((page, i) => {
    const key = encodeKey(page.path);
    const s = (r.path[key] ??= emptyPath());
    s.views += k;
    s.engaged_ms += page.engaged_ms * k;
    s.scroll_sum += page.scroll_max * k;
    if (!seenPaths.has(key)) {
      seenPaths.add(key);
      s.sessions += k;
    }
    if (i === 0) {
      s.entries += k;
      s.bounces += bounce * k;
    }
    if (i === pages.length - 1) s.exits += k;
  });

  const dims: Record<DimMap, string | null> = {
    country: session.country,
    region: session.country && session.region ? `${session.country}:${session.region}` : null,
    device: session.device,
    browser: session.browser,
    os: session.os,
    referrer: session.referrer_host,
    utm_source: session.utm_source,
    utm_medium: session.utm_medium,
    utm_campaign: session.utm_campaign,
  };
  const add = (target: DimStats) => {
    target.sessions += k;
    target.views += views * k;
    target.engaged_ms += engaged * k;
    target.bounces += bounce * k;
  };
  for (const m of DIM_MAPS) add((r[m][encodeKey(dims[m])] = emptyDim()));

  if (session.city) {
    const key = encodeKey(`${session.country ?? ''}:${session.region ?? ''}:${session.city}`);
    const city: CityStats = { ...emptyDim(), lat: session.lat, lon: session.lon };
    add(city);
    r.city[key] = city;
  }
  return r;
}

function addInto<T extends Record<string, number | null>>(target: T, source: T): void {
  for (const [field, value] of Object.entries(source)) {
    if (field === 'lat' || field === 'lon') {
      if (target[field] === null || target[field] === undefined) (target as Record<string, unknown>)[field] = value;
      continue;
    }
    (target as Record<string, number>)[field] = ((target[field] as number) ?? 0) + ((value as number) ?? 0);
  }
}

/** a + b. Counters add up; `sampled` is OR; a city keeps the first known lat/lon. Inputs are not changed. */
export function addRollup(a: Rollup, b: Rollup): Rollup {
  const out = structuredClone(a);
  out.views += b.views;
  out.sessions += b.sessions;
  out.bounces += b.bounces;
  out.engaged_ms += b.engaged_ms;
  out.sampled = out.sampled || b.sampled;
  for (const m of ROLLUP_MAP_FIELDS) {
    const target = out[m] as Record<string, Record<string, number | null>>;
    for (const [key, stats] of Object.entries(b[m] as Record<string, Record<string, number | null>>)) {
      if (target[key]) addInto(target[key], stats);
      else target[key] = { ...stats };
    }
  }
  return out;
}

/**
 * Keys kept per map in `a_daily`; the rest fold into `_other`.
 * The spec said 1,000, but Firestore allows 20,000 fields per doc: 11 maps of
 * 1,000 keys × 4–7 fields would pass that. 300 keeps the worst case near
 * 15,000 fields.
 */
export const DAILY_MAP_KEY_CAP = 300;

/** Keeps the top `cap` keys of every map (by views for `path`, by sessions otherwise) and folds the rest into `_other`. */
export function foldRollup(r: Rollup, cap = DAILY_MAP_KEY_CAP): Rollup {
  const out = structuredClone(r);
  for (const m of ROLLUP_MAP_FIELDS) {
    const map = out[m] as Record<string, Record<string, number | null>>;
    const keys = Object.keys(map);
    if (keys.length <= cap) continue;
    const rank = m === 'path' ? 'views' : 'sessions';
    keys.sort((x, y) => ((map[y][rank] as number) - (map[x][rank] as number)) || (x < y ? -1 : 1));
    const kept = new Set(keys.slice(0, cap - 1));
    let other: Record<string, number | null> | null = map[FOLD_KEY] ? { ...map[FOLD_KEY] } : null;
    for (const key of keys) {
      if (kept.has(key) || key === FOLD_KEY) continue;
      const stats = { ...map[key] };
      if ('lat' in stats) {
        stats.lat = null;
        stats.lon = null;
      }
      if (other) addInto(other, stats);
      else other = stats;
      delete map[key];
    }
    if (other) map[FOLD_KEY] = other;
  }
  return out;
}
