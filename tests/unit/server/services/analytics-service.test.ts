import { beforeEach, describe, expect, it } from 'vitest';

import {
  addRollup,
  emptyRollup,
  emptySession,
  hourKey,
  sessionRollup,
  type Rollup,
  type SessionDoc,
} from '@/server/analytics/model';
import { rangeWindows, rollupSourceFrom, type AnalyticsRange } from '@/server/analytics/rollup-window';
import { maskIpDto } from '@/server/analytics/session-dto';
import { FOLD_KEY, encodeKey } from '@/server/firestore/encode-key';
import { AnalyticsService, sampleSourceFrom } from '@/server/services/analytics-service';
import { MemoryEventRepository } from '../../../support/memory-event-repository';

const NOW = Date.parse('2026-11-14T10:30:00.000Z');
const range = (kind: string, from: string, to = '2026-11-14'): AnalyticsRange => ({
  kind,
  from,
  to,
  granularity: kind === 'today' || kind === '24h' ? 'hour' : 'day',
});
const r7 = range('7d', '2026-11-08');

let seq = 0;
type PageSpec = [path: string, engagedMs: number, scroll?: number];

function session(start: string, pages: PageSpec[], over: Partial<SessionDoc> = {}): SessionDoc {
  seq += 1;
  const id = seq.toString(16).padStart(32, '0');
  const t = new Date(start);
  const s = emptySession(id, new Date(t.getTime() + 60_000));
  s.started_at = t;
  pages.forEach(([path, ms, scroll = 0], i) => {
    s.pages[`p${i}`] = { path, ts: new Date(t.getTime() + i * 10_000), engaged_ms: ms, scroll_max: scroll };
  });
  s.pageviews = pages.length;
  s.engaged_ms = pages.reduce((sum, p) => sum + p[1], 0);
  s.entry_path = pages[0]?.[0] ?? null;
  s.exit_path = pages.at(-1)?.[0] ?? null;
  return Object.assign(s, over);
}

function rollupOf(sessions: SessionDoc[]): Rollup {
  return sessions.reduce((acc, s) => addRollup(acc, sessionRollup(s)), emptyRollup());
}

let repo: MemoryEventRepository;
let service: AnalyticsService;

function putDaily(day: string, sessions: SessionDoc[], patch: Partial<Rollup> = {}) {
  repo.daily.set(day, { ...rollupOf(sessions), ...patch, day, built_at: new Date(NOW) });
}

function putHourly(sessions: SessionDoc[]) {
  for (const s of sessions) {
    const hour = hourKey(s.started_at ?? s.last_seen_at);
    const cur = repo.hourly.get(hour);
    repo.hourly.set(hour, cur ? addRollup(cur, sessionRollup(s)) : sessionRollup(s));
  }
}

beforeEach(() => {
  seq = 0;
  repo = new MemoryEventRepository();
  service = new AnalyticsService({
    rollups: rollupSourceFrom(repo),
    samples: sampleSourceFrom(repo),
    sessions: repo,
    now: () => NOW,
  });
});

describe('windows', () => {
  it('7d = 6 past days from a_daily + today so far from a_hourly; previous = the 7 days before', () => {
    const { current, previous } = rangeWindows(r7, NOW);
    expect(current.days).toEqual(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
    expect(current.hours).toHaveLength(11);
    expect(current.hours[0]).toBe('2026-11-14-00');
    expect(previous.days[0]).toBe('2026-11-01');
    expect(previous.days).toHaveLength(7);
    expect(previous.hours).toEqual([]);
  });

  it('today compares with the same hours yesterday; 24h with the 24 hours before', () => {
    const today = rangeWindows(range('today', '2026-11-14'), NOW);
    expect(today.current.hours.at(-1)).toBe('2026-11-14-10');
    expect(today.previous.hours).toHaveLength(11);
    expect(today.previous.hours.at(-1)).toBe('2026-11-13-10');
    const last24 = rangeWindows(range('24h', '2026-11-13'), NOW);
    expect(last24.current.hours).toHaveLength(24);
    expect(last24.current.hours[0]).toBe('2026-11-13-11');
  });
});

describe('KPIs and the rollup + today merge', () => {
  it('adds past a_daily docs and today a_hourly docs, and reads the previous period', async () => {
    putDaily('2026-11-12', [session('2026-11-12T08:00:00Z', [['/', 30_000], ['/dashboard', 10_000]])]);
    putDaily('2026-11-13', [session('2026-11-13T09:00:00Z', [['/', 5_000]])]);
    putHourly([session('2026-11-14T09:10:00Z', [['/chat/[code]', 60_000]]), session('2026-11-14T10:05:00Z', [['/', 2_000]])]);
    putDaily('2026-11-03', [session('2026-11-03T12:00:00Z', [['/', 1_000]])]);

    const kpis = await service.getKpis(r7);
    expect(kpis.current).toEqual({
      visitors: 4,
      sessions: 4,
      pageviews: 5,
      avgEngagedMs: (40_000 + 5_000 + 60_000 + 2_000) / 4,
      bounceRate: 3 / 4,
    });
    expect(kpis.previous).toMatchObject({ sessions: 1, pageviews: 1, bounceRate: 1 });
    expect(kpis.meta).toMatchObject({ from: '2026-11-08', to: '2026-11-14', sampled: false, fallbackDays: [] });
    // 6 daily + 11 hourly (current) + 7 daily (previous); never a session doc.
    expect(repo.reads).toBe(24);
  });

  it('trend: one point per day with today collapsed, previous period aligned', async () => {
    putDaily('2026-11-13', [session('2026-11-13T09:00:00Z', [['/', 5_000]])]);
    putDaily('2026-11-06', [session('2026-11-06T09:00:00Z', [['/', 5_000]]), session('2026-11-06T10:00:00Z', [['/', 1]])]);
    putHourly([session('2026-11-14T01:00:00Z', [['/', 1]]), session('2026-11-14T07:00:00Z', [['/', 1], ['/x', 1]])]);
    const trend = await service.getTrend(r7);
    expect(trend.granularity).toBe('day');
    expect(trend.points.map((p) => p.key)).toEqual([
      '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14',
    ]);
    expect(trend.points.at(-1)).toMatchObject({ visitors: 2, pageviews: 3, prevKey: '2026-11-07', missing: false });
    expect(trend.points[5]).toMatchObject({ visitors: 1, prevKey: '2026-11-06', prevVisitors: 2 });
    expect(trend.points[0]).toMatchObject({ visitors: 0, missing: true, start: '2026-11-08T00:00:00.000Z' });
  });

  it('today is hourly', async () => {
    putHourly([session('2026-11-14T03:20:00Z', [['/', 1]])]);
    const trend = await service.getTrend(range('today', '2026-11-14'));
    expect(trend.granularity).toBe('hour');
    expect(trend.points).toHaveLength(11);
    expect(trend.points[3]).toMatchObject({ key: '2026-11-14-03', visitors: 1, start: '2026-11-14T03:00:00.000Z' });
  });

  it('rebuilds a missing recent a_daily from a_hourly, but not an old one', async () => {
    putHourly([session('2026-11-13T22:00:00Z', [['/', 1]])]);
    putHourly([session('2026-11-09T22:00:00Z', [['/', 1]])]); // older than 2 days: not a fallback day
    const kpis = await service.getKpis(r7);
    expect(kpis.current.sessions).toBe(1);
    expect(kpis.meta.fallbackDays).toEqual(['2026-11-13']);
  });

  it('flags sampled days', async () => {
    const s = session('2026-11-12T08:00:00Z', [['/', 1]], { sampled: true });
    putDaily('2026-11-12', [s]);
    putDaily('2026-11-13', [session('2026-11-13T08:00:00Z', [['/', 1]])]);
    const kpis = await service.getKpis(r7);
    expect(kpis.current.sessions).toBe(3); // sampled session counts ×2
    expect(kpis.meta).toMatchObject({ sampled: true, sampledDays: ['2026-11-12'] });
    expect((await service.getTrend(r7)).points.find((p) => p.key === '2026-11-12')?.sampled).toBe(true);
  });

  it('empty data: zeros, null rates, no rows', async () => {
    const kpis = await service.getKpis(r7);
    expect(kpis.current).toEqual({ visitors: 0, sessions: 0, pageviews: 0, avgEngagedMs: null, bounceRate: null });
    expect((await service.getBreakdown(r7, 'country')).rows).toEqual([]);
    expect((await service.getPageStats(r7)).rows).toEqual([]);
    expect((await service.getTrend(r7)).points.every((p) => p.missing && p.visitors === 0)).toBe(true);
  });
});

describe('top lists', () => {
  beforeEach(() => {
    putDaily('2026-11-13', [
      session('2026-11-13T01:00:00Z', [['/', 1]], { country: 'PK', region: 'PB', city: 'Lahore', lat: 31.5, lon: 74.3, referrer_host: 'google.com', device: 'mobile' }),
      session('2026-11-13T02:00:00Z', [['/', 1]], { country: 'PK', region: 'SD', city: 'Karachi', device: 'mobile' }),
      session('2026-11-13T03:00:00Z', [['/', 1]], { country: 'XX', utm_source: 'news.letter' }),
      session('2026-11-13T04:00:00Z', [['/', 1]], { country: null, device: 'desktop' }),
      session('2026-11-13T05:00:00Z', [['/', 1]], { country: 'US' }),
    ]);
  });

  it('decodes keys, names countries, merges XX with unknown, sorts by sessions', async () => {
    const { rows, totalSessions } = await service.getBreakdown(r7, 'country');
    expect(totalSessions).toBe(5);
    expect(rows.map((r) => [r.key, r.label, r.sessions])).toEqual([
      ['PK', 'Pakistan', 2],
      [null, 'Unknown', 2],
      ['US', 'United States', 1],
    ]);
    expect(rows[0].share).toBeCloseTo(0.4);
  });

  it('labels the empty bucket per dimension and decodes encoded values', async () => {
    const ref = await service.getBreakdown(r7, 'referrer');
    expect(ref.rows[0]).toMatchObject({ key: null, label: 'Direct / none', sessions: 4 });
    expect(ref.rows[1]).toMatchObject({ key: 'google.com', sessions: 1 });
    const utm = await service.getBreakdown(r7, 'utm_source');
    expect(utm.rows.map((r) => [r.key, r.label])).toEqual([[null, '(not set)'], ['news.letter', 'news.letter']]);
    const device = await service.getBreakdown(r7, 'device', { limit: 1 });
    expect(device.rows).toEqual([expect.objectContaining({ key: 'mobile', label: 'Mobile' })]);
    expect(device.totalRows).toBe(3);
  });

  it('drills country → region → city, with lat/lon on cities', async () => {
    const regions = await service.getBreakdown(r7, 'region', { country: 'PK' });
    expect(regions.rows.map((r) => [r.key, r.country, r.share])).toEqual([
      ['PB', 'PK', 0.5],
      ['SD', 'PK', 0.5],
    ]);
    const cities = await service.getBreakdown(r7, 'city', { country: 'PK', region: 'PB' });
    expect(cities.rows).toEqual([expect.objectContaining({ key: 'Lahore', region: 'PB', lat: 31.5, lon: 74.3 })]);
  });

  it('keeps the _other fold bucket last, and out of filtered levels', async () => {
    const doc = repo.daily.get('2026-11-13');
    if (!doc) throw new Error('missing fixture');
    doc.country[FOLD_KEY] = { sessions: 9, views: 9, engaged_ms: 0, bounces: 0 };
    doc.region[FOLD_KEY] = { sessions: 9, views: 9, engaged_ms: 0, bounces: 0 };
    doc.path[FOLD_KEY] = { views: 99, sessions: 9, engaged_ms: 0, bounces: 0, entries: 0, exits: 0, scroll_sum: 0 };
    const countries = await service.getBreakdown(r7, 'country');
    expect(countries.rows.at(-1)).toMatchObject({ key: FOLD_KEY, label: 'Other places', other: true, sessions: 9 });
    const regions = await service.getBreakdown(r7, 'region', { country: 'PK' });
    expect(regions.rows.some((r) => r.other)).toBe(false);
    const pages = await service.getPageStats(r7);
    expect(pages.rows.at(-1)).toMatchObject({ path: FOLD_KEY, label: 'Other pages', other: true });
  });
});

describe('pages', () => {
  it('per path: views, sessions, time, bounce, exits, scroll; trend from the same docs', async () => {
    putDaily('2026-11-13', [
      session('2026-11-13T01:00:00Z', [['/', 10_000, 50], ['/dashboard', 20_000, 100]]),
      session('2026-11-13T02:00:00Z', [['/', 4_000, 25]]),
    ]);
    putHourly([session('2026-11-14T02:00:00Z', [['/dashboard', 6_000, 0]])]);
    const { rows, totalPageviews } = await service.getPageStats(r7);
    expect(totalPageviews).toBe(4);
    const home = rows.find((r) => r.path === '/');
    expect(home).toMatchObject({ pageviews: 2, sessions: 2, entries: 2, exits: 1, avgEngagedMs: 7_000, bounceRate: 0.5, exitRate: 0.5 });
    expect(home?.avgScroll).toBeCloseTo(37.5);
    const dash = rows.find((r) => r.path === '/dashboard');
    expect(dash).toMatchObject({ pageviews: 2, entries: 1, exits: 2, bounceRate: 1 });

    const trend = await service.getPageTrend(r7, '/dashboard');
    expect(trend.points.slice(-2).map((p) => p.pageviews)).toEqual([1, 1]);
    expect(encodeKey('/dashboard')).not.toBe('/dashboard'); // stored encoded, shown decoded
  });

  it('page flow from the newest sessions in range', async () => {
    for (const s of [
      session('2026-11-13T01:00:00Z', [['/', 1], ['/chat/[code]', 1], ['/', 1]]),
      session('2026-11-13T02:00:00Z', [['/chat/[code]', 1]]),
      session('2026-11-13T03:00:00Z', [['/dashboard', 1], ['/chat/[code]', 1]]),
    ]) repo.sessions.set(s.id, s);
    const flow = await service.getPageFlow(r7, '/chat/[code]');
    expect(flow).toMatchObject({ sampleSize: 3, occurrences: 3, from: '2026-11-08', to: '2026-11-14' });
    expect(flow.prev.map((r) => [r.kind, r.path, r.count])).toEqual([
      ['page', '/', 1],
      ['page', '/dashboard', 1],
      ['entry', null, 1],
    ]);
    expect(flow.next.map((r) => [r.kind, r.path, r.count])).toEqual([
      ['exit', null, 2],
      ['page', '/', 1],
    ]);
    const entries = await service.getReferrerEntryPages(r7, null);
    expect(entries.matched).toBe(3);
  });
});

describe('sessions table', () => {
  beforeEach(() => {
    for (let i = 0; i < 30; i += 1) {
      const s = session(`2026-11-13T${String(i % 24).padStart(2, '0')}:${String(i).padStart(2, '0')}:00Z`, [['/', 1]], {
        country: i % 3 === 0 ? 'US' : 'PK',
        ip: i === 5 ? '203.0.113.7' : null,
        ip_trunc: '203.0.113.0',
      });
      repo.sessions.set(s.id, s);
    }
  });

  it('pages 25 newest first with a cursor, totals via count', async () => {
    const first = await service.listSessions({ range: r7 });
    expect(first).toMatchObject({ total: 30, mode: 'range' });
    expect(first.rows).toHaveLength(25);
    const starts = first.rows.map((r) => r.startedAt ?? '');
    expect([...starts].sort().reverse()).toEqual(starts);
    const second = await service.listSessions({ range: r7, cursor: first.nextCursor });
    expect(second.rows).toHaveLength(5);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(30);
  });

  it('24h lists the same 24 hourly buckets as the rollups, not 2 calendar days', async () => {
    // NOW = 11-14 10:30 → [11-13 11:00, 11-14 11:00): the 13 sessions at 11:xx–23:xx on 11-13.
    const last24 = await service.listSessions({ range: range('24h', '2026-11-13') });
    expect(last24.total).toBe(13);
    expect(last24.rows.every((r) => (r.startedAt ?? '') >= '2026-11-13T11:00:00.000Z')).toBe(true);
  });

  it('applies one indexed filter', async () => {
    const us = await service.listSessions({ range: r7, filter: { field: 'country', value: 'US' } });
    expect(us.total).toBe(10);
    expect(us.rows.every((r) => r.country === 'US')).toBe(true);
  });

  it('IP search ignores the range; truncated IPs are flagged; viewers get masked IPs', async () => {
    const found = await service.listSessions({ range: range('7d', '2026-11-14'), ip: '203.0.113.7' });
    expect(found).toMatchObject({ mode: 'ip', total: 1, nextCursor: null });
    expect(found.rows[0]).toMatchObject({ ip: '203.0.113.7', ipTruncated: false });
    expect(maskIpDto(found.rows[0], false)).toMatchObject({ ip: '203.0.113.•••', ipMasked: true });
    const page = await service.listSessions({ range: r7 });
    expect(page.rows.find((r) => r.ip === '203.0.113.0')).toMatchObject({ ipTruncated: true });
  });

  it('detail: timeline with wall time; null when gone', async () => {
    const s = session('2026-11-13T01:00:00Z', [['/', 3_000], ['/dashboard', 5_000]]);
    repo.sessions.set(s.id, s);
    const detail = await service.getSessionDetail(s.id);
    expect(detail?.pages.map((p) => [p.path, p.wallMs])).toEqual([
      ['/', 10_000],
      ['/dashboard', 50_000],
    ]);
    expect(await service.getSessionDetail('f'.repeat(32))).toBeNull();
  });
});

describe('live', () => {
  it('counts the last 90 s, lists the last 5 min, recent page views newest first', async () => {
    const mk = (secondsAgo: number, device: 'mobile' | 'desktop', path: string) => {
      const s = session(new Date(NOW - secondsAgo * 1000 - 20_000).toISOString(), [[path, 1]], { device });
      s.last_seen_at = new Date(NOW - secondsAgo * 1000);
      repo.sessions.set(s.id, s);
    };
    mk(10, 'mobile', '/chat/[code]');
    mk(60, 'mobile', '/chat/[code]');
    mk(80, 'desktop', '/');
    mk(200, 'desktop', '/');
    mk(900, 'desktop', '/');
    const live = await service.getLive();
    expect(live).toMatchObject({ online: 3, listed: 4, topPath: '/chat/[code]' });
    expect(live.byDevice).toEqual({ desktop: 1, mobile: 2, tablet: 0, unknown: 0 });
    expect(live.sessions.map((s) => s.active)).toEqual([true, true, true, false]);
    expect(live.events).toHaveLength(4);
    expect(live.events[0].ts > live.events[1].ts).toBe(true);
    expect(await service.countOnline()).toEqual({ count: 3, at: new Date(NOW).toISOString() });
  });
});
