import 'server-only';

import type { PageEntry, SessionDoc } from '@/server/analytics/model';
import { maskIp } from '@/shared/lib/mask-ip';
import type {
  FlowRow,
  IpDto,
  LiveEventDto,
  LiveSessionDto,
  SampleShareRow,
  SessionDetailDto,
  SessionRowDto,
  TimelinePageDto,
} from './dto';

/** Session docs → DTOs, and the small session samples behind page flow and drills. Pure. */

/** Tracker cap on page views per session. */
export const SESSION_PAGE_CAP = 100;

/** Full IP while held, else the truncated one. Unmasked: mask per role with `maskIpDto`. */
function ipOf(s: SessionDoc): IpDto {
  if (s.ip) return { ip: s.ip, ipMasked: false, ipTruncated: false };
  return { ip: s.ip_trunc, ipMasked: false, ipTruncated: s.ip_trunc !== null };
}

/** Hides the host part for roles without `ip:read`. Run after the cache, per request. */
export function maskIpDto<T extends IpDto>(dto: T, canSeeIp: boolean): T {
  if (canSeeIp || dto.ip === null) return dto;
  return { ...dto, ip: maskIp(dto.ip), ipMasked: true };
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/** Pages with a path, oldest first, with their ids. */
function orderedPages(s: SessionDoc): (PageEntry & { id: string })[] {
  return Object.entries(s.pages)
    .map(([id, p]) => ({ ...p, id }))
    .sort((a, b) => (a.ts?.getTime() ?? 0) - (b.ts?.getTime() ?? 0) || (a.id < b.id ? -1 : 1));
}

export function toSessionRow(s: SessionDoc): SessionRowDto {
  const start = s.started_at?.getTime() ?? null;
  return {
    id: s.id,
    startedAt: iso(s.started_at),
    lastSeenAt: s.last_seen_at.toISOString(),
    durationMs: start === null ? 0 : Math.max(0, s.last_seen_at.getTime() - start),
    pageviews: s.pageviews,
    engagedMs: s.engaged_ms,
    entryPath: s.entry_path,
    exitPath: s.exit_path,
    country: s.country,
    region: s.region,
    city: s.city,
    device: s.device,
    browser: s.browser,
    os: s.os,
    referrerHost: s.referrer_host,
    utmSource: s.utm_source,
    userId: s.user_id,
    sampled: s.sampled,
    ...ipOf(s),
  };
}

export function toSessionDetail(s: SessionDoc): SessionDetailDto {
  const pages = orderedPages(s);
  const timeline: TimelinePageDto[] = pages.map((p, i) => {
    const next = pages[i + 1]?.ts ?? null;
    const end = next ?? (i === pages.length - 1 ? s.last_seen_at : null);
    return {
      id: p.id,
      ts: iso(p.ts),
      path: p.path,
      engagedMs: p.engaged_ms,
      wallMs: p.ts && end ? Math.max(0, end.getTime() - p.ts.getTime()) : null,
      scrollMax: p.scroll_max,
    };
  });
  return {
    ...toSessionRow(s),
    tz: s.tz,
    lat: s.lat,
    lon: s.lon,
    browserVersion: s.browser_version,
    viewport: s.viewport_w !== null && s.viewport_h !== null ? { w: s.viewport_w, h: s.viewport_h } : null,
    utmMedium: s.utm_medium,
    utmCampaign: s.utm_campaign,
    vitals: s.vitals,
    pages: timeline,
    pageCapReached: pages.length >= SESSION_PAGE_CAP,
  };
}

/** The open page: the newest page view with a path, else the exit path. */
export function currentPath(s: SessionDoc): string | null {
  const withPath = orderedPages(s).filter((p) => p.path !== null);
  return withPath.at(-1)?.path ?? s.exit_path;
}

export function toLiveSession(s: SessionDoc, activeSinceMs: number): LiveSessionDto {
  return {
    sessionId: s.id,
    country: s.country,
    region: s.region,
    city: s.city,
    lat: s.lat,
    lon: s.lon,
    device: s.device,
    browser: s.browser,
    currentPath: currentPath(s),
    startedAt: iso(s.started_at),
    lastSeenAt: s.last_seen_at.toISOString(),
    userId: s.user_id,
    active: s.last_seen_at.getTime() > activeSinceMs,
    ...ipOf(s),
  };
}

/** Page views newer than `sinceMs` from the live list, newest first. */
export function liveEvents(sessions: SessionDoc[], sinceMs: number, limit: number): LiveEventDto[] {
  const events: LiveEventDto[] = [];
  for (const s of sessions) {
    for (const p of orderedPages(s)) {
      if (!p.path || !p.ts || p.ts.getTime() <= sinceMs) continue;
      events.push({ id: `${s.id}:${p.id}`, ts: p.ts.toISOString(), kind: 'pageview', path: p.path, country: s.country, device: s.device, sessionId: s.id });
    }
  }
  return events.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Session samples (page flow, referrer drill, browser versions)

/** The few fields the sample screens need: small enough to cache 500 of them. */
export type SessionSample = {
  referrer: string | null;
  entry: string | null;
  browser: string | null;
  version: string | null;
  /** Viewed paths in order. */
  paths: string[];
};

export function toSample(s: SessionDoc): SessionSample {
  return {
    referrer: s.referrer_host,
    entry: s.entry_path ?? orderedPages(s).find((p) => p.path)?.path ?? null,
    browser: s.browser,
    version: s.browser_version,
    paths: orderedPages(s).flatMap((p) => (p.path ? [p.path] : [])),
  };
}

function topShares(counts: Map<string | null, number>, limit: number): SampleShareRow[] {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count, share: total > 0 ? count / total : 0 }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)))
    .slice(0, limit);
}

function bump<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Came from / went to for one path, top `limit` each. */
export function pageFlow(samples: SessionSample[], path: string, limit = 5): { prev: FlowRow[]; next: FlowRow[]; occurrences: number } {
  const prev = new Map<string | null, number>();
  const next = new Map<string | null, number>();
  let occurrences = 0;
  for (const s of samples) {
    s.paths.forEach((p, i) => {
      if (p !== path) return;
      occurrences += 1;
      bump(prev, i > 0 ? s.paths[i - 1] : null);
      bump(next, i < s.paths.length - 1 ? s.paths[i + 1] : null);
    });
  }
  const rows = (counts: Map<string | null, number>, edge: 'entry' | 'exit'): FlowRow[] =>
    topShares(counts, limit).map((r) => ({ kind: r.key === null ? edge : 'page', path: r.key, count: r.count, share: r.share }));
  return { prev: rows(prev, 'entry'), next: rows(next, 'exit'), occurrences };
}

/** Entry pages of sessions from one referrer host (`null` = direct). */
export function referrerEntryPages(samples: SessionSample[], host: string | null, limit = 5) {
  const matched = samples.filter((s) => s.referrer === host);
  const counts = new Map<string | null, number>();
  for (const s of matched) bump(counts, s.entry);
  return { rows: topShares(counts, limit), matched: matched.length };
}

/** Versions of one browser. */
export function browserVersions(samples: SessionSample[], browser: string, limit = 10) {
  const matched = samples.filter((s) => s.browser === browser);
  const counts = new Map<string | null, number>();
  for (const s of matched) bump(counts, s.version);
  return { rows: topShares(counts, limit), matched: matched.length };
}
