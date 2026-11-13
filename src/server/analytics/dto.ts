import 'server-only';

import type { Device } from '@/server/analytics/model';

/**
 * DTOs of the analytics screens. JSON-safe (dates are ISO strings, rates are
 * 0..1 fractions or null when there is nothing to divide by), so they cross
 * the Next data cache and the server/client boundary unchanged. Client code
 * imports them with `import type` from `@/features/admin/analytics/types`.
 * "Visitors" = sessions: there is no cross-session visitor id.
 */

export type Granularity = 'day' | 'hour';

/** What every range-based DTO carries about the data behind it. */
export type RangeMeta = {
  from: string;
  to: string;
  granularity: Granularity;
  /** True when any day in the range had sampling on (counts ×2): show the "sampled" badge. */
  sampled: boolean;
  /** UTC days (`YYYY-MM-DD`) with `sampled: true`. */
  sampledDays: string[];
  /** Past days with no `a_daily` doc yet, rebuilt from `a_hourly` ("Yesterday may be incomplete"). */
  fallbackDays: string[];
};

export type Kpis = {
  visitors: number;
  sessions: number;
  pageviews: number;
  /** Visible time per session, ms. */
  avgEngagedMs: number | null;
  /** Sessions with one page view / sessions. */
  bounceRate: number | null;
};

/** `previous` is the period of the same length just before. */
export type KpisDto = { current: Kpis; previous: Kpis; meta: RangeMeta; previousMeta: RangeMeta };

export type TrendPoint = {
  /** `YYYY-MM-DD` or, hourly, `YYYY-MM-DD-HH`. */
  key: string;
  /** Start of the slot, ISO (UTC). */
  start: string;
  visitors: number;
  pageviews: number;
  /** The slot at the same position in the previous period. */
  prevKey: string | null;
  prevVisitors: number;
  prevPageviews: number;
  sampled: boolean;
  /** No rollup doc for this slot (shown as 0). */
  missing: boolean;
};

export type TrendDto = { granularity: Granularity; points: TrendPoint[]; meta: RangeMeta };

export type BreakdownDim =
  | 'country'
  | 'region'
  | 'city'
  | 'device'
  | 'browser'
  | 'os'
  | 'referrer'
  | 'utm_source'
  | 'utm_medium'
  | 'utm_campaign';

export type BreakdownRow = {
  /**
   * Decoded value (`PK`, `google.com`, `mobile`). `null` = unknown / direct /
   * not set. `_other` = the long tail the daily build folded together.
   */
  key: string | null;
  /** Display text: country name, "Direct / none", "(not set)", "Unknown", "Other". */
  label: string;
  other: boolean;
  visitors: number;
  sessions: number;
  pageviews: number;
  avgEngagedMs: number | null;
  bounceRate: number | null;
  /** Sessions / all sessions of the listed level (0..1). */
  share: number;
  /** Region and city rows: ISO country code, else null. */
  country: string | null;
  /** City rows: region code; region rows: the same as `key`. */
  region: string | null;
  /** City rows only (first known position), else null. */
  lat: number | null;
  lon: number | null;
};

export type BreakdownDto = {
  dim: BreakdownDim;
  rows: BreakdownRow[];
  /** All sessions of the listed level (before `limit`). */
  totalSessions: number;
  /** Rows before `limit`. */
  totalRows: number;
  meta: RangeMeta;
};

export type PageRow = {
  /** Normalised path (`/chat/[code]`), or `_other`. */
  path: string;
  label: string;
  other: boolean;
  pageviews: number;
  /** = sessions that viewed the path. */
  visitors: number;
  sessions: number;
  entries: number;
  exits: number;
  /** engaged_ms / views. */
  avgEngagedMs: number | null;
  /** bounces / entries. */
  bounceRate: number | null;
  /** exits / views. */
  exitRate: number | null;
  /** scroll_sum / views, 0..100. */
  avgScroll: number | null;
  /** Views / all views (0..1). */
  share: number;
};

export type PageStatsDto = { rows: PageRow[]; totalPageviews: number; meta: RangeMeta };

export type PageTrendDto = {
  path: string;
  granularity: Granularity;
  points: { key: string; start: string; pageviews: number; sampled: boolean }[];
  meta: RangeMeta;
};

export type FlowRow = { kind: 'page' | 'entry' | 'exit'; path: string | null; count: number; share: number };

/** Came from / went to, from the newest sessions in range (sample). */
export type PageFlowDto = {
  path: string;
  prev: FlowRow[];
  next: FlowRow[];
  /** Sessions read (≤ 500). */
  sampleSize: number;
  /** Times the path was viewed inside the sample. */
  occurrences: number;
  /** The sample range (span cut to 30 days). */
  from: string;
  to: string;
};

export type SampleShareRow = { key: string | null; count: number; share: number };

export type SampleBreakdownDto = { rows: SampleShareRow[]; sampleSize: number; matched: number; from: string; to: string };

/** IP as a role may see it. `ipMasked` when the role lacks `ip:read`. */
export type IpDto = {
  ip: string | null;
  ipMasked: boolean;
  /** Full IP already nulled by retention; `ip` shows the /24 or /48. */
  ipTruncated: boolean;
};

export type SessionRowDto = IpDto & {
  id: string;
  startedAt: string | null;
  lastSeenAt: string;
  durationMs: number;
  pageviews: number;
  engagedMs: number;
  entryPath: string | null;
  exitPath: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  device: Device | null;
  browser: string | null;
  os: string | null;
  referrerHost: string | null;
  utmSource: string | null;
  userId: string | null;
  sampled: boolean;
};

export type SessionListDto = {
  rows: SessionRowDto[];
  nextCursor: string | null;
  /** `count()` of the whole filtered range. IP search: rows found (≤ 100). */
  total: number;
  mode: 'range' | 'ip';
};

export type TimelinePageDto = {
  id: string;
  ts: string | null;
  path: string | null;
  engagedMs: number;
  /** Next page view's ts − this ts; the last page uses last_seen_at. Null without a ts. */
  wallMs: number | null;
  scrollMax: number;
};

export type SessionDetailDto = SessionRowDto & {
  tz: string | null;
  lat: number | null;
  lon: number | null;
  browserVersion: string | null;
  viewport: { w: number; h: number } | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  vitals: { lcp: number | null; inp: number | null; cls: number | null } | null;
  pages: TimelinePageDto[];
  /** Tracker cap of 100 pages reached. */
  pageCapReached: boolean;
};

export type LiveSessionDto = IpDto & {
  sessionId: string;
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  device: Device | null;
  browser: string | null;
  currentPath: string | null;
  startedAt: string | null;
  lastSeenAt: string;
  userId: string | null;
  /** Seen in the online window (90 s); the rest of the list is the last 5 min. */
  active: boolean;
};

export type LiveEventDto = {
  id: string;
  ts: string;
  kind: 'pageview';
  path: string;
  country: string | null;
  device: Device | null;
  sessionId: string;
};

export type LiveDto = {
  at: string;
  /** `count()` of sessions seen in the last 90 s. */
  online: number;
  /** Rows in `sessions` (last 5 min, ≤ 100). */
  listed: number;
  byDevice: Record<Device | 'unknown', number>;
  topPath: string | null;
  sessions: LiveSessionDto[];
  events: LiveEventDto[];
};

export type OnlineDto = { count: number; at: string };
