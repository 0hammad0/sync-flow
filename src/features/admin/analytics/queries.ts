import 'server-only';

import { unstable_cache } from 'next/cache';
import { cache } from 'react';

import type { BreakdownOptions } from '@/server/analytics/breakdowns';
import type {
  BreakdownDim,
  BreakdownDto,
  KpisDto,
  LiveDto,
  OnlineDto,
  PageFlowDto,
  PageStatsDto,
  PageTrendDto,
  SampleBreakdownDto,
  SessionDetailDto,
  SessionListDto,
  TrendDto,
} from '@/server/analytics/dto';
import { DEFAULT_TRACKING_SETTINGS, type TrackingSettings } from '@/server/analytics/model';
import {
  concatSets,
  EMPTY_SET,
  rollupSourceFrom,
  utcDay,
  type RollupSet,
  type RollupSource,
} from '@/server/analytics/rollup-window';
import { maskIpDto, type SessionSample } from '@/server/analytics/session-dto';
import { getEventRepository, getQuota } from '@/server/container-light';
import { QuotaExceededError } from '@/server/quota/quota-guard';
import type { EventReader, SessionFilter } from '@/server/repositories/interfaces';
import { AnalyticsService, sampleSourceFrom, type SessionListInput } from '@/server/services/analytics-service';
import { normaliseIp } from '@/shared/lib/ip';
import { resolveRange, type RangeParams, type ResolvedRange } from './range';

// Analytics queries for the Overview, Live, Sessions, Pages, Geography and
// Sources screens (and the CSV export). The caller has already passed
// requireAdmin('analytics:read'). Every Firestore read goes through the
// EventReader, which asks QuotaGuard first (refuses at the read cap → state
// 'budget') and counts every read. All cached under the `rollups` tag:
//
// | Data                              | Lifetime | Reads on a cache miss                         |
// |-----------------------------------|----------|-----------------------------------------------|
// | `a_daily`, days older than 2 days | 24 h     | 1 per day (one getAll)                         |
// | `a_daily`, yesterday + day before | 1 h      | 1 per day, + 24 per day with no doc (fallback) |
// | `a_hourly` (today, 24h)           | 5 min    | 1 per hour asked (≤ 24 for today)              |
// | Sessions page + count             | 5 min    | ≤ 25 + 1 per 1,000 matches (count)             |
// | IP search                         | 5 min    | ≤ 100                                         |
// | Session detail                    | 5 min    | 1                                             |
// | Flow / drill sample               | 30 min   | ≤ 500 (shared by flow, referrer, browsers)     |
// | Live                              | 30 s     | 1 count + ≤ 100                               |
// | Online now                        | 30 s     | 1 count (1 per 1,000 online)                  |
// | Tracking settings (retention)     | 5 min    | 1                                             |
//
// Rollup-backed screens share the same cached docs, so Overview + Pages +
// Geography + Sources on one range cost the reads once.

export const ROLLUPS_TAG = 'rollups';
const SETTLED_DAYS_TTL_S = 86_400;
const RECENT_DAYS_TTL_S = 3_600;
const HOURLY_TTL_S = 300;
const SESSIONS_TTL_S = 300;
const SAMPLE_TTL_S = 1_800;
const LIVE_TTL_S = 30;
const SETTINGS_TTL_S = 300;

/** Same shape as the Health / Files query results. */
export type QueryResult<T> =
  | { state: 'ok'; data: T }
  /** Today's admin read budget is used up (QuotaGuard). */
  | { state: 'budget' }
  | { state: 'error'; errorId: string };

function reader(): EventReader {
  return getEventRepository();
}

/** `Error 9` style summary: a Firestore message can hold a doc path or an IP. */
function errorKind(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' || typeof code === 'number' ? `${name} ${code}` : name;
}

async function run<T>(what: string, read: () => Promise<T>): Promise<QueryResult<T>> {
  try {
    return { state: 'ok', data: await read() };
  } catch (error) {
    if (error instanceof QuotaExceededError) return { state: 'budget' };
    const errorId = crypto.randomUUID();
    console.error(`[admin] analytics: ${what} failed ${errorId}`, errorKind(error));
    return { state: 'error', errorId };
  }
}

// ---------------------------------------------------------------------------
// Cached sources. Errors throw out of unstable_cache, so failures are never
// cached. React `cache` dedupes the same read between widgets of one render.

const settledDays = unstable_cache(
  (days: string[]): Promise<RollupSet> => rollupSourceFrom(reader()).days(days, []),
  ['admin-analytics-daily'],
  { tags: [ROLLUPS_TAG], revalidate: SETTLED_DAYS_TTL_S },
);

const recentDays = unstable_cache(
  (days: string[]): Promise<RollupSet> => rollupSourceFrom(reader()).days(days, days),
  ['admin-analytics-daily-recent'],
  { tags: [ROLLUPS_TAG], revalidate: RECENT_DAYS_TTL_S },
);

const hourlyDocs = unstable_cache(
  (hours: string[]): Promise<RollupSet> => rollupSourceFrom(reader()).hours(hours),
  ['admin-analytics-hourly'],
  { tags: [ROLLUPS_TAG], revalidate: HOURLY_TTL_S },
);

const settledMemo = cache((key: string) => settledDays(key.split(',')));
const recentMemo = cache((key: string) => recentDays(key.split(',')));
const hourlyMemo = cache((key: string) => hourlyDocs(key.split(',')));

/** Splits past days into "settled" (cached 24 h) and the ones the cron may still rebuild (1 h). */
const cachedRollups: RollupSource = {
  async days(days, hourlyFallback) {
    const recent = new Set(hourlyFallback);
    const old = days.filter((d) => !recent.has(d));
    const fresh = days.filter((d) => recent.has(d));
    const [a, b] = await Promise.all([
      old.length > 0 ? settledMemo(old.join(',')) : EMPTY_SET,
      fresh.length > 0 ? recentMemo(fresh.join(',')) : EMPTY_SET,
    ]);
    const set = concatSets(a, b);
    const order = new Map(days.map((d, i) => [d, i]));
    return { ...set, slots: [...set.slots].sort((x, y) => (order.get(x.key) ?? 0) - (order.get(y.key) ?? 0)) };
  },
  hours(hours) {
    return hours.length > 0 ? hourlyMemo(hours.join(',')) : Promise.resolve(EMPTY_SET);
  },
};

const sampleDocs = unstable_cache(
  (from: string, to: string, limit: number): Promise<SessionSample[]> => sampleSourceFrom(reader()).sample(from, to, limit),
  ['admin-analytics-sample'],
  { tags: [ROLLUPS_TAG], revalidate: SAMPLE_TTL_S },
);
const sampleMemo = cache((from: string, to: string, limit: number) => sampleDocs(from, to, limit));

let service: AnalyticsService | null = null;

function analytics(): AnalyticsService {
  service ??= new AnalyticsService({
    rollups: cachedRollups,
    samples: { sample: sampleMemo },
    sessions: reader(),
  });
  return service;
}

// ---------------------------------------------------------------------------
// Range

const cachedSettings = unstable_cache(
  async (): Promise<TrackingSettings> => {
    await getQuota().assertCan('reads');
    return reader().readTrackingSettings();
  },
  ['admin-analytics-settings'],
  { tags: [ROLLUPS_TAG], revalidate: SETTINGS_TTL_S },
);

/**
 * The range for a screen. `rollups` screens (Overview, Pages, Geography,
 * Sources) take any span up to 365 days; `sessions` screens (Sessions,
 * samples, sessions export) are clamped to the raw retention window from
 * `admin_config/settings` (default 90 days; defaults when it cannot be read).
 */
export async function resolveAnalyticsRange(
  params: RangeParams,
  scope: 'rollups' | 'sessions' = 'rollups',
): Promise<ResolvedRange> {
  const today = utcDay(Date.now());
  if (scope === 'rollups') return resolveRange(params, { today });
  const settings = await cachedSettings().catch(() => DEFAULT_TRACKING_SETTINGS);
  return resolveRange(params, { today, retentionDays: settings.rawRetentionDays });
}

// ---------------------------------------------------------------------------
// Overview (02-overview.md)

/** Visitors, sessions, page views, avg time, bounce + previous period. 7d: 6 daily + ≤ 24 hourly + 7 daily (previous). */
export function getOverviewKpis(range: ResolvedRange): Promise<QueryResult<KpisDto>> {
  return run('kpis', () => analytics().getKpis(range));
}

/** Visitors per day (per hour for today / 24h) with the previous period. Same docs as the KPIs. */
export function getVisitorTrend(range: ResolvedRange): Promise<QueryResult<TrendDto>> {
  return run('trend', () => analytics().getTrend(range));
}

/** Top pages by views. Same docs as the KPIs. */
export function listTopPaths(range: ResolvedRange, limit = 8): Promise<QueryResult<PageStatsDto>> {
  return run('top paths', async () => {
    const stats = await analytics().getPageStats(range);
    return { ...stats, rows: stats.rows.slice(0, limit) };
  });
}

export function listTopCountries(range: ResolvedRange, limit = 8): Promise<QueryResult<BreakdownDto>> {
  return getBreakdown(range, 'country', { limit });
}

/** Referrer hosts; `key: null` is "Direct / none". */
export function listTopReferrers(range: ResolvedRange, limit = 8): Promise<QueryResult<BreakdownDto>> {
  return getBreakdown(range, 'referrer', { limit });
}

/** "N online now" (top bar, Overview). 1 `count()`, cached 30 s. */
const cachedOnline = unstable_cache(() => analytics().countOnline(), ['admin-analytics-online'], {
  tags: [ROLLUPS_TAG],
  revalidate: LIVE_TTL_S,
});

export function countOnlineNow(): Promise<QueryResult<OnlineDto>> {
  return run('online count', cachedOnline);
}

// ---------------------------------------------------------------------------
// Breakdowns: Geography (07) and Sources (08)

/** Any breakdown map, sessions desc, `_other` last. Reads the same cached rollups. */
export function getBreakdown(
  range: ResolvedRange,
  dim: BreakdownDim,
  options: BreakdownOptions & { limit?: number } = {},
): Promise<QueryResult<BreakdownDto>> {
  return run(`breakdown ${dim}`, () => analytics().getBreakdown(range, dim, options));
}

export function listCountryStats(range: ResolvedRange): Promise<QueryResult<BreakdownDto>> {
  return getBreakdown(range, 'country');
}

export function listRegionStats(range: ResolvedRange, country: string): Promise<QueryResult<BreakdownDto>> {
  return getBreakdown(range, 'region', { country });
}

/** Cities of a country, or of one region when given. Rows carry lat / lon. */
export function listCityStats(range: ResolvedRange, country: string, region?: string | null): Promise<QueryResult<BreakdownDto>> {
  return getBreakdown(range, 'city', { country, region: region ?? null });
}

/** Sources tabs: referrer, utm_source / utm_medium / utm_campaign, device, browser, os. */
export type SourceDim = Extract<BreakdownDim, 'referrer' | 'utm_source' | 'utm_medium' | 'utm_campaign' | 'device' | 'browser' | 'os'>;

export function listSourceStats(range: ResolvedRange, dim: SourceDim): Promise<QueryResult<BreakdownDto>> {
  return getBreakdown(range, dim);
}

/** Top entry pages for one referrer host (`null` = direct), from the newest 500 sessions (≤ 30 days). */
export function getReferrerEntryPages(range: ResolvedRange, host: string | null): Promise<QueryResult<SampleBreakdownDto>> {
  return run('referrer drill', () => analytics().getReferrerEntryPages(range, host));
}

/** Versions of one browser, same sample. */
export function getBrowserVersions(range: ResolvedRange, browser: string): Promise<QueryResult<SampleBreakdownDto>> {
  return run('browser versions', () => analytics().getBrowserVersions(range, browser));
}

// ---------------------------------------------------------------------------
// Pages (05-pages.md)

/** Every path (search, mode, sort and paging happen in memory on these rows). */
export function getPageStats(range: ResolvedRange): Promise<QueryResult<PageStatsDto>> {
  return run('page stats', () => analytics().getPageStats(range));
}

export function getPageTrend(range: ResolvedRange, path: string): Promise<QueryResult<PageTrendDto>> {
  return run('page trend', () => analytics().getPageTrend(range, path));
}

/** Came from / went to, from the newest 500 sessions in range (≤ 30 days). */
export function getPageFlow(range: ResolvedRange, path: string): Promise<QueryResult<PageFlowDto>> {
  return run('page flow', () => analytics().getPageFlow(range, path));
}

// ---------------------------------------------------------------------------
// Sessions (04-sessions.md)

const cachedSessions = unstable_cache(
  (input: SessionListInput): Promise<SessionListDto> => analytics().listSessions(input),
  ['admin-analytics-sessions'],
  { tags: [ROLLUPS_TAG], revalidate: SESSIONS_TTL_S },
);

export type ListSessionsInput = {
  range: ResolvedRange;
  filter?: SessionFilter | null;
  /** Free text: an exact IPv4/IPv6 switches to IP search (any date, ≤ 100 rows). */
  ip?: string | null;
  cursor?: string | null;
};

/** One page of 25, `started_at desc`, one indexed filter, total via `count()`. IPs masked without `ip:read`. */
export function listSessions(input: ListSessionsInput, access: { canSeeIp: boolean }): Promise<QueryResult<SessionListDto>> {
  return run('sessions', async () => {
    const ip = input.ip ? normaliseIp(input.ip) : null;
    const data = await cachedSessions({
      range: { from: input.range.from, to: input.range.to },
      filter: ip ? null : (input.filter ?? null),
      ip,
      cursor: ip ? null : (input.cursor ?? null),
    });
    return { ...data, rows: data.rows.map((r) => maskIpDto(r, access.canSeeIp)) };
  });
}

/** Session ids are 16 random bytes in hex (tracker). */
export const SESSION_ID_RE = /^[0-9a-f]{32}$/;

const cachedSession = unstable_cache(
  async (id: string): Promise<SessionDetailDto | null> => {
    await getQuota().assertCan('reads');
    return analytics().getSessionDetail(id);
  },
  ['admin-analytics-session'],
  { tags: [ROLLUPS_TAG], revalidate: SESSIONS_TTL_S },
);

/** Header + timeline of one session (1 read). `data: null` for a bad id (no read) or a deleted session. */
export function getSessionDetail(id: string, access: { canSeeIp: boolean }): Promise<QueryResult<SessionDetailDto | null>> {
  if (!SESSION_ID_RE.test(id)) return Promise.resolve({ state: 'ok', data: null });
  return run('session detail', async () => {
    const data = await cachedSession(id);
    return data ? maskIpDto(data, access.canSeeIp) : null;
  });
}

// ---------------------------------------------------------------------------
// Live (03-live.md)

const cachedLive = unstable_cache(() => analytics().getLive(), ['admin-analytics-live'], {
  tags: [ROLLUPS_TAG],
  revalidate: LIVE_TTL_S,
});

/** Online count, the last 5 min of sessions (≤ 100) and their recent page views. Ignores the range. */
export function getLive(access: { canSeeIp: boolean }): Promise<QueryResult<LiveDto>> {
  return run('live', async () => {
    const data = await cachedLive();
    return { ...data, sessions: data.sessions.map((s) => maskIpDto(s, access.canSeeIp)) };
  });
}
