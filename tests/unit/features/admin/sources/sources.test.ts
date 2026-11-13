import { describe, expect, it } from 'vitest';

import type { BreakdownRow } from '@/features/admin/analytics/types';
import { dimFor } from '@/features/admin/sources/constants';
import {
  donutParts,
  drillItems,
  drillKeyFor,
  drillSubject,
  hasNoTags,
  hostFromParam,
  isWebHost,
  selectSourceRows,
  sortSourceRows,
  toSourceRow,
  truncateLabel,
} from '@/features/admin/sources/rows';
import { parseSourcesParams } from '@/features/admin/sources/schemas';

function row(key: string | null, label: string, sessions: number, over: Partial<BreakdownRow> = {}): BreakdownRow {
  return {
    key,
    label,
    other: key === '_other',
    visitors: sessions,
    sessions,
    pageviews: sessions * 2,
    avgEngagedMs: 1000,
    bounceRate: 0.5,
    share: 0,
    country: null,
    region: null,
    lat: null,
    lon: null,
    ...over,
  };
}

describe('URL params', () => {
  it('defaults to referrers, UTM source, most visitors first', () => {
    expect(parseSourcesParams({})).toEqual({ tab: 'referrers', utm: 'source', sort: '-visitors', cursor: 0, drill: null });
  });

  it('unknown tab, utm field or sort fall back silently', () => {
    expect(parseSourcesParams({ tab: 'campaigns', utm: 'term', sort: '-sessions_x' })).toMatchObject({
      tab: 'referrers',
      utm: 'source',
      sort: '-visitors',
    });
    expect(parseSourcesParams({ tab: 'utm', utm: 'campaign', sort: 'bounceRate' })).toMatchObject({
      tab: 'utm',
      utm: 'campaign',
      sort: 'bounceRate',
    });
  });

  it('reads the drill param of the current tab only', () => {
    expect(parseSourcesParams({ host: 'google.com' }).drill).toBe('google.com');
    expect(parseSourcesParams({ tab: 'browsers', browser: 'Chrome', host: 'google.com' }).drill).toBe('Chrome');
    expect(parseSourcesParams({ tab: 'devices', host: 'google.com', browser: 'Chrome' }).drill).toBeNull();
    expect(parseSourcesParams({ tab: 'utm', host: 'google.com' }).drill).toBeNull();
  });

  it('maps each tab to its rollup map', () => {
    expect(dimFor('referrers', 'source')).toBe('referrer');
    expect(dimFor('utm', 'medium')).toBe('utm_medium');
    expect(dimFor('devices', 'campaign')).toBe('device');
    expect(dimFor('browsers', 'source')).toBe('browser');
    expect(dimFor('os', 'source')).toBe('os');
  });
});

describe('rows', () => {
  it('Direct / none and Other are muted buckets with stable ids', () => {
    const direct = toSourceRow('referrers', row(null, 'Direct / none', 10));
    expect(direct).toMatchObject({ id: '(none)', bucket: true, drillKey: '(direct)', externalUrl: null });
    const other = toSourceRow('referrers', row('_other', 'Other', 3));
    expect(other).toMatchObject({ id: '_other', bucket: true, drillKey: null, externalUrl: null });
    const google = toSourceRow('referrers', row('google.com', 'google.com', 5));
    expect(google).toMatchObject({ id: 'k:google.com', bucket: false, drillKey: 'google.com', externalUrl: 'https://google.com' });
  });

  it('drills: referrers (direct included) and named browsers only', () => {
    expect(drillKeyFor('browsers', row('Chrome', 'Chrome', 1))).toBe('Chrome');
    expect(drillKeyFor('browsers', row(null, 'Unknown', 1))).toBeNull();
    expect(drillKeyFor('devices', row('mobile', 'Mobile', 1))).toBeNull();
    expect(drillKeyFor('utm', row('newsletter', 'newsletter', 1))).toBeNull();
    expect(hostFromParam('(direct)')).toBeNull();
    expect(hostFromParam('t.co')).toBe('t.co');
  });

  it('links only real web hosts', () => {
    expect(isWebHost('news.ycombinator.com')).toBe(true);
    expect(isWebHost('t.co')).toBe(true);
    expect(isWebHost('localhost')).toBe(false);
    expect(isWebHost('192.168.1.10')).toBe(false);
    expect(isWebHost(null)).toBe(false);
  });

  it('keeps named rows first, then (none), then Other, whatever the sort', () => {
    const rows = [row('_other', 'Other', 900), row(null, 'Direct / none', 500), row('a.com', 'a.com', 5), row('b.com', 'b.com', 50)];
    expect(sortSourceRows(rows, '-visitors').map((r) => r.label)).toEqual(['b.com', 'a.com', 'Direct / none', 'Other']);
    expect(sortSourceRows(rows, 'visitors').map((r) => r.label)).toEqual(['a.com', 'b.com', 'Direct / none', 'Other']);
    expect(sortSourceRows(rows, 'label').map((r) => r.label).slice(0, 2)).toEqual(['a.com', 'b.com']);
  });

  it('pages 25 at a time and keeps the session total of every row', () => {
    const many = Array.from({ length: 30 }, (_, i) => row(`h${i}.com`, `h${i}.com`, 100 - i));
    const first = selectSourceRows('referrers', many, { sort: '-visitors', cursor: 0 });
    expect(first).toMatchObject({ total: 30, nextCursor: '25', prevCursor: null });
    expect(first.rows).toHaveLength(25);
    expect(first.totalSessions).toBe(many.reduce((s, r) => s + r.sessions, 0));
    const second = selectSourceRows('referrers', many, { sort: '-visitors', cursor: 25 });
    expect(second).toMatchObject({ nextCursor: null, prevCursor: '' });
    expect(second.rows).toHaveLength(5);
  });

  it('a UTM map with only "(not set)" has no tags', () => {
    expect(hasNoTags([row(null, '(not set)', 12)])).toBe(true);
    expect(hasNoTags([row(null, '(not set)', 12), row('newsletter', 'newsletter', 1)])).toBe(false);
  });

  it('cuts long campaign names at 60 characters', () => {
    const long = 'c'.repeat(80);
    expect(truncateLabel(long, 60)).toHaveLength(60);
    expect(truncateLabel(long, 60).endsWith('…')).toBe(true);
    expect(truncateLabel('spring', 60)).toBe('spring');
  });
});

describe('donut parts', () => {
  it('devices in the fixed palette order, Unknown only when there is some', () => {
    const rows = [row('mobile', 'Mobile', 40), row('desktop', 'Desktop', 58), row('tablet', 'Tablet', 3)];
    expect(donutParts('device', rows)).toEqual([
      { label: 'Desktop', value: 58 },
      { label: 'Mobile', value: 40 },
      { label: 'Tablet', value: 3 },
    ]);
    expect(donutParts('device', [...rows, row(null, 'Unknown', 2)]).at(-1)).toEqual({ label: 'Unknown', value: 2 });
    expect(donutParts('device', [row('mobile', 'Mobile', 1)])).toEqual([
      { label: 'Desktop', value: 0 },
      { label: 'Mobile', value: 1 },
      { label: 'Tablet', value: 0 },
    ]);
  });

  it('browsers: top three, then Other for the rest (unknown and folded included)', () => {
    const rows = [
      row('Chrome', 'Chrome', 50),
      row('Safari', 'Safari', 30),
      row('Firefox', 'Firefox', 10),
      row('Edge', 'Edge', 5),
      row(null, 'Unknown', 3),
      row('_other', 'Other', 2),
    ];
    expect(donutParts('browser', rows)).toEqual([
      { label: 'Chrome', value: 50 },
      { label: 'Safari', value: 30 },
      { label: 'Firefox', value: 10 },
      { label: 'Other', value: 10 },
    ]);
    expect(donutParts('os', [row('iOS', 'iOS', 4)])).toEqual([{ label: 'iOS', value: 4 }]);
  });
});

describe('drill labels', () => {
  it('names the subject and each row in plain words', () => {
    expect(drillSubject('referrers', '(direct)')).toBe('Direct / none');
    expect(drillSubject('referrers', 'google.com')).toBe('google.com');
    expect(drillSubject('browsers', 'Chrome')).toBe('Chrome');
    expect(
      drillItems('browsers', 'Chrome', [
        { key: '131', count: 4, share: 0.8 },
        { key: null, count: 1, share: 0.2 },
      ]),
    ).toEqual([
      { label: 'Chrome 131', value: 4 },
      { label: 'Unknown version', value: 1 },
    ]);
    expect(
      drillItems('referrers', 'google.com', [
        { key: '/', count: 2, share: 0.5 },
        { key: '_other', count: 1, share: 0.25 },
        { key: null, count: 1, share: 0.25 },
      ]).map((i) => i.label),
    ).toEqual(['/', 'Other pages', 'Unknown page']);
  });
});
