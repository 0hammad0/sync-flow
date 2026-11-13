import { describe, expect, it } from 'vitest';
import type { ResolvedRange } from '@/features/admin/analytics/range';
import type { KpisDto, RangeMeta, TrendDto } from '@/features/admin/analytics/types';
import {
  buildKpiCards,
  formatKpiCount,
  formatKpiValue,
  hasVisits,
  kpiChange,
  previousLabel,
  rangeQuery,
} from '@/features/admin/overview/kpis';
import { parseOverviewParams } from '@/features/admin/overview/schemas';
import { dataStartDay, trendPoints, trendSummary } from '@/features/admin/overview/trend';

const range7d: ResolvedRange = { kind: '7d', from: '2026-11-08', to: '2026-11-14', days: 7, granularity: 'day', clamped: false };
const meta: RangeMeta = { from: range7d.from, to: range7d.to, granularity: 'day', sampled: false, sampledDays: [], fallbackDays: [] };

const COUNT = { kind: 'count', higherIsBetter: true } as const;
const TIME = { kind: 'duration', higherIsBetter: true } as const;
const BOUNCE = { kind: 'rate', higherIsBetter: false } as const;

describe('formatKpiValue', () => {
  it('shows counts in full up to 9,999,999, then 1 decimal + M', () => {
    expect(formatKpiCount(1284)).toBe('1,284');
    expect(formatKpiCount(9_999_999)).toBe('9,999,999');
    expect(formatKpiCount(12_402_118)).toBe('12.4M');
  });

  it('formats durations (ms in), rates (0..1 in) and missing values', () => {
    expect(formatKpiValue('duration', 161_000)).toBe('2m 41s');
    expect(formatKpiValue('duration', 45_400)).toBe('45s');
    expect(formatKpiValue('rate', 0.382)).toBe('38.2%');
    expect(formatKpiValue('rate', 0.5)).toBe('50.0%');
    expect(formatKpiValue('rate', null)).toBe('—');
    expect(formatKpiValue('duration', null)).toBe('—');
  });
});

describe('kpiChange', () => {
  it('counts: signed percent with a real minus, up is good', () => {
    expect(kpiChange(COUNT, 1284, 1142)).toMatchObject({ text: '+12.4%', sign: 1, good: true, spoken: 'up 12.4%' });
    expect(kpiChange(COUNT, 900, 1000)).toMatchObject({ text: '−10%', sign: -1, good: false, spoken: 'down 10%' });
    expect(kpiChange(COUNT, 5, 5)).toMatchObject({ text: '0%', sign: 0, good: null, spoken: 'no change' });
  });

  it('is null when the previous period is 0 or missing (card shows "—")', () => {
    expect(kpiChange(COUNT, 12, 0)).toBeNull();
    expect(kpiChange(TIME, 60_000, null)).toBeNull();
    expect(kpiChange(BOUNCE, null, 0.4)).toBeNull();
  });

  it('avg time: the difference as a duration', () => {
    expect(kpiChange(TIME, 161_000, 152_000)).toMatchObject({ text: '+9s', sign: 1, good: true });
    expect(kpiChange(TIME, 100_000, 190_000)).toMatchObject({ text: '−1m 30s', sign: -1, good: false });
    expect(kpiChange(TIME, 100_400, 100_000)).toMatchObject({ text: '0s', sign: 0 });
  });

  it('bounce rate: percentage points, and down is good', () => {
    expect(kpiChange(BOUNCE, 0.382, 0.395)).toMatchObject({ text: '−1.3 pt', sign: -1, good: true, spoken: 'down 1.3 pt' });
    expect(kpiChange(BOUNCE, 0.5, 0.4)).toMatchObject({ text: '+10.0 pt', sign: 1, good: false });
    expect(kpiChange(BOUNCE, 0.4, 0.4)).toMatchObject({ text: '0 pt', sign: 0, good: null });
  });
});

describe('previousLabel / rangeQuery', () => {
  it('names the compare period', () => {
    expect(previousLabel({ kind: 'today', days: 1 })).toBe('same hours yesterday');
    expect(previousLabel({ kind: '24h', days: 2 })).toBe('previous 24 hours');
    expect(previousLabel({ kind: '7d', days: 7 })).toBe('previous 7 days');
    expect(previousLabel({ kind: 'custom', days: 1 })).toBe('previous day');
  });

  it('carries the range to other screens', () => {
    expect(rangeQuery(range7d)).toBe('?range=7d');
    expect(rangeQuery({ kind: 'custom', from: '2026-11-01', to: '2026-11-05' }, { path: '/' })).toBe(
      '?path=%2F&range=custom&from=2026-11-01&to=2026-11-05',
    );
  });
});

describe('buildKpiCards', () => {
  const dto: KpisDto = {
    current: { visitors: 1284, sessions: 1284, pageviews: 6377, avgEngagedMs: 161_000, bounceRate: 0.382 },
    previous: { visitors: 1142, sessions: 1142, pageviews: 0, avgEngagedMs: 152_000, bounceRate: 0.395 },
    meta,
    previousMeta: meta,
  };

  it('builds 5 cards with links, exact tooltips and full accessible names', () => {
    const cards = buildKpiCards(dto, range7d);
    expect(cards.map((c) => c.label)).toEqual(['Visitors', 'Sessions', 'Page views', 'Avg time', 'Bounce rate']);
    const [visitors, , pageviews, time, bounce] = cards;
    expect(visitors.value).toBe('1,284');
    expect(visitors.href).toBe('/admin/sessions?range=7d');
    expect(visitors.ariaLabel).toBe('Visitors 1,284, up 12.4% vs previous 7 days');
    expect(visitors.tooltip).toBe('1,284 visitors · previous 7 days: 1,142');
    expect(visitors.hint).toBe('Counted per browser tab session.');
    expect(pageviews.change).toBeNull();
    expect(pageviews.tooltip).toBe('6,377 page views · No data in the previous 7 days.');
    expect(pageviews.ariaLabel).toBe('Page views 6,377, no data in the previous 7 days');
    expect(time.tooltip).toBe('Avg time 2m 41s · previous 7 days: 2m 32s');
    expect(bounce.change?.good).toBe(true);
  });

  it('uses the singular for one visitor', () => {
    const one: KpisDto = { ...dto, current: { ...dto.current, visitors: 1 } };
    expect(buildKpiCards(one, range7d)[0].tooltip).toBe('1 visitor · previous 7 days: 1,142');
  });

  it('hasVisits is false for an empty range', () => {
    expect(hasVisits({ visitors: 0, sessions: 0, pageviews: 0, avgEngagedMs: null, bounceRate: null })).toBe(false);
    expect(hasVisits(dto.current)).toBe(true);
  });
});

describe('overview schema', () => {
  it('reads the range params and never throws on junk', () => {
    expect(parseOverviewParams({ range: '30d' })).toEqual({ range: '30d', from: null, to: null });
    expect(parseOverviewParams({ range: 'forever', from: '2026-02-30' })).toEqual({ range: null, from: null, to: null });
    expect(parseOverviewParams(undefined)).toEqual({ range: null, from: null, to: null });
  });
});

describe('trend', () => {
  const point = (key: string, visitors: number, prev: number, missing = false) => ({
    key,
    start: `${key}T00:00:00.000Z`,
    visitors,
    pageviews: visitors,
    prevKey: 'x',
    prevVisitors: prev,
    prevPageviews: prev,
    sampled: false,
    missing,
  });
  const dto: TrendDto = {
    granularity: 'day',
    meta,
    points: [point('2026-11-11', 0, 0, true), point('2026-11-12', 0, 0, true), point('2026-11-13', 3, 0), point('2026-11-14', 9, 0)],
  };

  it('maps points to the chart (t = bucket start, compare = previous)', () => {
    expect(trendPoints(dto)[2]).toEqual({ t: Date.UTC(2026, 10, 13), value: 3, compare: 0 });
  });

  it('summarises for screen readers, with no delta when the previous period is empty', () => {
    expect(trendSummary(dto, range7d)).toBe('Visitors, last 7 days: 12 total. Peak 9 on 14 Nov.');
  });

  it('says where the data starts when tracking began inside the range', () => {
    expect(dataStartDay(dto)).toBe('2026-11-13');
    expect(dataStartDay({ ...dto, points: dto.points.slice(2) })).toBeNull();
    expect(dataStartDay({ ...dto, granularity: 'hour' })).toBeNull();
  });
});
