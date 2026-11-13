import 'server-only';

import { breakdownRows, kpisOf, pageRows, trendPoints, type BreakdownOptions } from '@/server/analytics/breakdowns';
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
import {
  loadWindow,
  metaOf,
  rangeWindows,
  slotStart,
  utcDay,
  type AnalyticsRange,
  type RollupSet,
  type RollupSource,
  type RollupWindow,
} from '@/server/analytics/rollup-window';
import {
  browserVersions,
  currentPath,
  liveEvents,
  pageFlow,
  referrerEntryPages,
  toLiveSession,
  toSessionDetail,
  toSample,
  toSessionRow,
  type SessionSample,
} from '@/server/analytics/session-dto';
import { encodeKey } from '@/server/firestore/encode-key';
import type { EventReader, SessionFilter } from '@/server/repositories/interfaces';

export type { AnalyticsRange } from '@/server/analytics/rollup-window';

/** Rows per sessions page (04-sessions.md). */
export const SESSIONS_PAGE_SIZE = 25;
/** IP search returns at most this many sessions, any date. */
export const IP_SEARCH_LIMIT = 100;
/** "Online now" window: seen in the last 90 s (03-live.md). */
export const ONLINE_WINDOW_MS = 90_000;
/** Live list: seen in the last 5 min, newest first, at most 100. */
export const LIVE_LIST_WINDOW_MS = 5 * 60_000;
export const LIVE_LIST_LIMIT = 100;
export const LIVE_EVENTS_LIMIT = 50;
/** Flow and drill samples: the newest 500 sessions of a range of at most 30 days. */
export const SAMPLE_SIZE = 500;
export const SAMPLE_MAX_DAYS = 30;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Where session samples come from (cached in production). */
export interface SampleSource {
  /** The newest `limit` sessions started in [`from`, `to`), both ISO instants. */
  sample(from: string, to: string, limit: number): Promise<SessionSample[]>;
}

type SessionReader = Pick<
  EventReader,
  'getSession' | 'listSessions' | 'countSessions' | 'findSessionsByIp' | 'countActiveSessions' | 'listActiveSessions'
>;

export type AnalyticsServiceDeps = {
  rollups: RollupSource;
  samples: SampleSource;
  sessions: SessionReader;
  now?: () => number;
};

export type SessionListInput = {
  range: SessionRange;
  filter?: SessionFilter | null;
  /** Normalised IP: exact search, any date, range and filter ignored. */
  ip?: string | null;
  cursor?: string | null;
};

function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** [from 00:00, day after `to` 00:00) in UTC. */
function dayBounds(from: string, to: string): { from: Date; to: Date } {
  return { from: dayStart(from), to: new Date(dayStart(to).getTime() + DAY_MS) };
}

/**
 * The `started_at` window of a range's sessions. `24h` is the same 24 hourly
 * buckets the rollup screens read (rangeWindows: current hour + 23 before),
 * not its 2 calendar days. Every other range is whole UTC days.
 */
export function sessionBounds(range: SessionRange, nowMs: number): { from: Date; to: Date } {
  if (range.kind === '24h') {
    const hourEnd = Math.floor(nowMs / HOUR_MS) * HOUR_MS + HOUR_MS;
    return { from: new Date(hourEnd - 24 * HOUR_MS), to: new Date(hourEnd) };
  }
  return dayBounds(range.from, range.to);
}

/** A range as the session reads need it; `kind` only changes `24h`. */
export type SessionRange = Pick<AnalyticsRange, 'from' | 'to'> & { kind?: string };

/**
 * Visitor analytics for the admin screens (02–08 feature specs). Totals and
 * breakdowns come only from rollups (`a_daily` for past days + today's
 * `a_hourly`, merged with `addRollup`); sessions are read only for the
 * sessions table, Live, and the ≤ 500-session samples. Returns JSON-safe DTOs
 * with unmasked IPs: callers mask per role (`maskIpDto`) after caching.
 */
export class AnalyticsService {
  private readonly now: () => number;

  constructor(private readonly deps: AnalyticsServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  private async current(range: AnalyticsRange): Promise<{ window: RollupWindow; set: RollupSet }> {
    const now = this.now();
    const { current } = rangeWindows(range, now);
    return { window: current, set: await loadWindow(this.deps.rollups, current, now) };
  }

  private async both(range: AnalyticsRange) {
    const now = this.now();
    const { current, previous } = rangeWindows(range, now);
    const [cur, prev] = await Promise.all([
      loadWindow(this.deps.rollups, current, now),
      loadWindow(this.deps.rollups, previous, now),
    ]);
    return { current, previous, cur, prev };
  }

  /** Visitors, sessions, page views, avg time, bounce rate, and the previous period. */
  async getKpis(range: AnalyticsRange): Promise<KpisDto> {
    const { current, previous, cur, prev } = await this.both(range);
    return {
      current: kpisOf(cur.merged),
      previous: kpisOf(prev.merged),
      meta: metaOf(current, cur),
      previousMeta: metaOf(previous, prev),
    };
  }

  /** Per day, or per hour for today / 24h, with the previous period at the same positions. */
  async getTrend(range: AnalyticsRange): Promise<TrendDto> {
    const { current, cur, prev } = await this.both(range);
    return { granularity: current.granularity, points: trendPoints(cur.slots, prev.slots), meta: metaOf(current, cur) };
  }

  /**
   * One breakdown map (country, region, city, device, browser, os, referrer,
   * utm_*), sessions desc, `_other` last. `limit` keeps the top rows (totals
   * still count all of them).
   */
  async getBreakdown(range: AnalyticsRange, dim: BreakdownDim, options: BreakdownOptions & { limit?: number } = {}): Promise<BreakdownDto> {
    const { window, set } = await this.current(range);
    const rows = breakdownRows(set.merged, dim, options);
    const totalSessions = rows.reduce((sum, r) => sum + r.sessions, 0);
    return {
      dim,
      rows: options.limit ? rows.slice(0, options.limit) : rows,
      totalSessions,
      totalRows: rows.length,
      meta: metaOf(window, set),
    };
  }

  /** Every path's views, sessions, time, bounce, exit and scroll. The screen pages, searches and sorts in memory. */
  async getPageStats(range: AnalyticsRange): Promise<PageStatsDto> {
    const { window, set } = await this.current(range);
    const rows = pageRows(set.merged);
    return { rows, totalPageviews: rows.reduce((sum, r) => sum + r.pageviews, 0), meta: metaOf(window, set) };
  }

  /** Views of one path per day (per hour for today / 24h). Same docs as the table. */
  async getPageTrend(range: AnalyticsRange, path: string): Promise<PageTrendDto> {
    const { window, set } = await this.current(range);
    const key = encodeKey(path);
    return {
      path,
      granularity: window.granularity,
      points: set.slots.map((s) => ({ key: s.key, start: slotStart(s.key), pageviews: s.paths[key] ?? 0, sampled: s.sampled })),
      meta: metaOf(window, set),
    };
  }

  /** The sample range: the range's last 30 days at most. */
  private sampleSpan(range: Pick<AnalyticsRange, 'from' | 'to'>): { from: string; to: string } {
    const earliest = utcDay(dayStart(range.to).getTime() - (SAMPLE_MAX_DAYS - 1) * DAY_MS);
    return { from: range.from < earliest ? earliest : range.from, to: range.to };
  }

  private async sample(range: SessionRange) {
    const span = this.sampleSpan(range);
    const bounds = sessionBounds({ ...span, kind: range.kind }, this.now());
    const samples = await this.deps.samples.sample(bounds.from.toISOString(), bounds.to.toISOString(), SAMPLE_SIZE);
    return { span, samples };
  }

  /** Came from / went to for a path, from the newest 500 sessions of the range (≤ 30 days). */
  async getPageFlow(range: SessionRange, path: string): Promise<PageFlowDto> {
    const { span, samples } = await this.sample(range);
    return { path, ...pageFlow(samples, path), sampleSize: samples.length, ...span };
  }

  /** Top entry pages of sessions from one referrer host (`null` = direct), same sample. */
  async getReferrerEntryPages(range: SessionRange, host: string | null): Promise<SampleBreakdownDto> {
    const { span, samples } = await this.sample(range);
    return { ...referrerEntryPages(samples, host), sampleSize: samples.length, ...span };
  }

  /** Versions of one browser, same sample. */
  async getBrowserVersions(range: SessionRange, browser: string): Promise<SampleBreakdownDto> {
    const { span, samples } = await this.sample(range);
    return { ...browserVersions(samples, browser), sampleSize: samples.length, ...span };
  }

  /**
   * One page of the sessions table: `started_at desc`, 25 rows, cursor
   * paging, one optional indexed filter, total via `count()`. An IP search
   * reads `ip ==` (≤ 100, any date) and sorts in memory.
   */
  async listSessions(input: SessionListInput): Promise<SessionListDto> {
    if (input.ip) {
      const found = await this.deps.sessions.findSessionsByIp(input.ip, IP_SEARCH_LIMIT);
      const rows = found
        .sort((a, b) => (b.started_at?.getTime() ?? 0) - (a.started_at?.getTime() ?? 0))
        .map(toSessionRow);
      return { rows, nextCursor: null, total: rows.length, mode: 'ip' };
    }
    const query = { ...sessionBounds(input.range, this.now()), filter: input.filter ?? null };
    const [page, total] = await Promise.all([
      this.deps.sessions.listSessions({ ...query, limit: SESSIONS_PAGE_SIZE, cursor: input.cursor ?? null }),
      this.deps.sessions.countSessions(query),
    ]);
    return { rows: page.sessions.map(toSessionRow), nextCursor: page.nextCursor, total, mode: 'range' };
  }

  /** Header + timeline from the one session doc, or null when it is gone (retention). */
  async getSessionDetail(id: string): Promise<SessionDetailDto | null> {
    const doc = await this.deps.sessions.getSession(id);
    return doc ? toSessionDetail(doc) : null;
  }

  /** Online count (`count()`, 90 s) plus the last 5 min of sessions (≤ 100) and their recent page views. */
  async getLive(): Promise<LiveDto> {
    const now = this.now();
    const activeSince = now - ONLINE_WINDOW_MS;
    const listSince = now - LIVE_LIST_WINDOW_MS;
    const [online, docs] = await Promise.all([
      this.deps.sessions.countActiveSessions(new Date(activeSince)),
      this.deps.sessions.listActiveSessions(new Date(listSince), LIVE_LIST_LIMIT),
    ]);
    const active = docs.filter((s) => s.last_seen_at.getTime() > activeSince);
    const byDevice = { desktop: 0, mobile: 0, tablet: 0, unknown: 0 };
    const paths = new Map<string, number>();
    for (const s of active) {
      byDevice[s.device ?? 'unknown'] += 1;
      const path = currentPath(s);
      if (path) paths.set(path, (paths.get(path) ?? 0) + 1);
    }
    const topPath = [...paths.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    return {
      at: new Date(now).toISOString(),
      online,
      listed: docs.length,
      byDevice,
      topPath,
      sessions: docs.map((s) => toLiveSession(s, activeSince)),
      events: liveEvents(docs, listSince, LIVE_EVENTS_LIMIT),
    };
  }

  /** The top-bar "N online" count: one `count()`. */
  async countOnline(): Promise<OnlineDto> {
    const now = this.now();
    const count = await this.deps.sessions.countActiveSessions(new Date(now - ONLINE_WINDOW_MS));
    return { count, at: new Date(now).toISOString() };
  }
}

/** Samples straight from the repository: ≤ `limit` reads. */
export function sampleSourceFrom(reader: Pick<EventReader, 'listNewestSessions'>): SampleSource {
  return {
    async sample(from, to, limit) {
      const docs = await reader.listNewestSessions({ from: new Date(from), to: new Date(to), limit });
      return docs.map(toSample);
    },
  };
}
