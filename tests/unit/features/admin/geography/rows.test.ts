import { describe, expect, it } from 'vitest';
import type { BreakdownRow } from '@/features/admin/analytics/types';
import { geoEmptyCopy } from '@/features/admin/geography/copy';
import { UNKNOWN_REGION } from '@/features/admin/geography/drill';
import {
  GEO_PAGE_SIZE,
  decodePlaceName,
  mapDataOf,
  mapSummaryOf,
  pageGeoRows,
  parseOffset,
  sortGeoRows,
  toGeoRows,
  type GeoRow,
} from '@/features/admin/geography/rows';

function row(partial: Partial<BreakdownRow>): BreakdownRow {
  return {
    key: null,
    label: '',
    other: false,
    visitors: 0,
    sessions: 0,
    pageviews: 0,
    avgEngagedMs: null,
    bounceRate: null,
    share: 0,
    country: null,
    region: null,
    lat: null,
    lon: null,
    ...partial,
  };
}

const countries: BreakdownRow[] = [
  row({ key: 'PK', label: 'Pakistan', country: 'PK', visitors: 6, sessions: 6, pageviews: 10, avgEngagedMs: 182_000, bounceRate: 0.31 }),
  row({ key: 'US', label: 'United States', country: 'US', visitors: 2, sessions: 2, pageviews: 2, avgEngagedMs: 100_000, bounceRate: 0.5 }),
  row({ key: null, label: 'Unknown', visitors: 1, sessions: 1, pageviews: 1, avgEngagedMs: 12_000, bounceRate: 1 }),
  row({ key: '_other', label: 'Other places', other: true, visitors: 1, sessions: 1, pageviews: 1, avgEngagedMs: 0, bounceRate: 1 }),
];

describe('toGeoRows: countries', () => {
  const rows = toGeoRows(countries, 'country', { country: null, region: null });

  it('maps numbers into table units', () => {
    expect(rows[0]).toEqual({
      id: 'PK',
      label: 'Pakistan',
      code: 'PK',
      drill: { country: 'PK', region: null },
      unknown: false,
      other: false,
      visitors: 6,
      pageviews: 10,
      avgTimeS: 182,
      bouncePct: 31,
      share: 0.6,
    });
  });

  it('keeps Unknown as a row that counts in the share, but does not drill', () => {
    const unknown = rows.find((r) => r.unknown)!;
    expect(unknown).toMatchObject({ id: '_unknown', label: 'Unknown', code: null, drill: null, share: 0.1 });
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1);
  });

  it('never drills into Other places', () => {
    expect(rows.at(-1)).toMatchObject({ id: '_other', label: 'Other places', other: true, drill: null, code: null });
  });

  it('keeps null rates as null', () => {
    const [r] = toGeoRows([row({ key: 'DE', visitors: 1 })], 'country', { country: null, region: null });
    expect(r.avgTimeS).toBeNull();
    expect(r.bouncePct).toBeNull();
  });
});

describe('toGeoRows: region and city keys', () => {
  const pk = { country: 'PK', region: null };

  it('drills a region row to its cities, the unknown region to the marker', () => {
    const rows = toGeoRows(
      [
        row({ key: 'PB', label: 'PB', country: 'PK', region: 'PB', visitors: 4 }),
        row({ key: null, label: 'Unknown', country: 'PK', region: null, visitors: 1 }),
      ],
      'region',
      pk,
    );
    expect(rows.map((r) => [r.id, r.label, r.drill])).toEqual([
      ['PB', 'PB', { country: 'PK', region: 'PB' }],
      ['_unknown', 'Unknown', { country: 'PK', region: UNKNOWN_REGION }],
    ]);
  });

  it('does not drill a region key that cannot be a URL param', () => {
    const [r] = toGeoRows([row({ key: 'Some:Place', country: 'PK', region: 'Some:Place', visitors: 1 })], 'region', pk);
    expect(r.drill).toBeNull();
    expect(r.label).toBe('Some:Place');
  });

  it('decodes city names and never drills cities', () => {
    const rows = toGeoRows(
      [
        row({ key: 'S%C3%A3o%20Paulo', country: 'BR', region: 'SP', visitors: 2 }),
        row({ key: 'Zürich', country: 'CH', region: 'ZH', visitors: 1 }),
        row({ key: null, country: 'BR', region: 'SP', visitors: 1 }),
      ],
      'city',
      { country: 'BR', region: 'SP' },
    );
    expect(rows.map((r) => [r.id, r.label, r.drill])).toEqual([
      ['SP|S%C3%A3o%20Paulo', 'São Paulo', null],
      ['ZH|Zürich', 'Zürich', null],
      ['SP|', 'Unknown', null],
    ]);
  });

  it('lists only region-less cities for the unknown region, share over those', () => {
    const rows = toGeoRows(
      [
        row({ key: 'Lahore', country: 'PK', region: 'PB', visitors: 5 }),
        row({ key: 'Karachi', country: 'PK', region: null, visitors: 3 }),
        row({ key: null, country: 'PK', region: null, visitors: 1 }),
      ],
      'city',
      { country: 'PK', region: UNKNOWN_REGION },
    );
    expect(rows.map((r) => r.label)).toEqual(['Karachi', 'Unknown']);
    expect(rows[0].share).toBeCloseTo(0.75);
  });
});

describe('decodePlaceName', () => {
  it('decodes percent-encoding and leaves plain or broken text alone', () => {
    expect(decodePlaceName('Z%C3%BCrich')).toBe('Zürich');
    expect(decodePlaceName('New+York%20City')).toBe('New York City');
    expect(decodePlaceName('100% Town')).toBe('100% Town');
    expect(decodePlaceName('%E0%A4%A')).toBe('%E0%A4%A');
    expect(decodePlaceName('Lahore')).toBe('Lahore');
  });
});

describe('sortGeoRows', () => {
  const rows = toGeoRows(countries, 'country', { country: null, region: null });
  const labels = (list: GeoRow[]) => list.map((r) => r.label);

  it('sorts by visitors by default and keeps Other places last', () => {
    expect(labels(sortGeoRows(rows, '-visitors'))).toEqual(['Pakistan', 'United States', 'Unknown', 'Other places']);
    expect(labels(sortGeoRows(rows, 'visitors'))).toEqual(['Unknown', 'United States', 'Pakistan', 'Other places']);
  });

  it('sorts by place name and by rates', () => {
    expect(labels(sortGeoRows(rows, 'place'))).toEqual(['Pakistan', 'United States', 'Unknown', 'Other places']);
    expect(labels(sortGeoRows(rows, '-place'))).toEqual(['Unknown', 'United States', 'Pakistan', 'Other places']);
    expect(labels(sortGeoRows(rows, '-bounce'))).toEqual(['Unknown', 'United States', 'Pakistan', 'Other places']);
    expect(labels(sortGeoRows(rows, 'avg_time'))).toEqual(['Unknown', 'United States', 'Pakistan', 'Other places']);
  });

  it('puts empty values last in both directions, and falls back on an unknown sort', () => {
    const withNull = [...rows, { ...rows[0], id: 'DE', label: 'Germany', avgTimeS: null, visitors: 9 }];
    expect(sortGeoRows(withNull, 'avg_time').at(-2)?.label).toBe('Germany');
    expect(sortGeoRows(withNull, '-avg_time').at(-2)?.label).toBe('Germany');
    expect(labels(sortGeoRows(rows, 'nope'))).toEqual(labels(sortGeoRows(rows, '-visitors')));
  });
});

describe('paging', () => {
  const many: GeoRow[] = Array.from({ length: 120 }, (_, i) => ({
    id: `c${i}`,
    label: `City ${i}`,
    code: null,
    drill: null,
    unknown: false,
    other: false,
    visitors: 1,
    pageviews: 1,
    avgTimeS: 1,
    bouncePct: 0,
    share: 1 / 120,
  }));

  it('reads offsets on page boundaries only', () => {
    expect(parseOffset(null, 120)).toBe(0);
    expect(parseOffset('50', 120)).toBe(50);
    expect(parseOffset('49', 120)).toBe(0);
    expect(parseOffset('150', 120)).toBe(0);
    expect(parseOffset('-50', 120)).toBe(0);
    expect(parseOffset('abc', 120)).toBe(0);
  });

  it('pages at 50 with cursors DataTable understands', () => {
    expect(GEO_PAGE_SIZE).toBe(50);
    const first = pageGeoRows(many, null);
    expect(first).toMatchObject({ prevCursor: null, nextCursor: '50', total: 120 });
    expect(first.rows).toHaveLength(50);
    const second = pageGeoRows(many, '50');
    expect(second).toMatchObject({ prevCursor: '', nextCursor: '100' });
    const last = pageGeoRows(many, '100');
    expect(last).toMatchObject({ prevCursor: '50', nextCursor: null });
    expect(last.rows).toHaveLength(20);
    expect(pageGeoRows([], null)).toEqual({ rows: [], prevCursor: null, nextCursor: null, total: 0 });
  });
});

describe('map data', () => {
  it('leaves Unknown and Other places off the map', () => {
    expect(mapDataOf(countries)).toEqual([
      { country: 'PK', value: 6 },
      { country: 'US', value: 2 },
    ]);
  });

  it('summarises the top countries over the full total', () => {
    expect(mapSummaryOf(countries, 10)).toBe('World map of visitors. Top countries: Pakistan 60%, United States 20%.');
    expect(mapSummaryOf([], 0)).toBe('World map of visitors. No located visits.');
  });
});

describe('geoEmptyCopy', () => {
  const world = { country: null, region: null };

  it('world level: short ranges offer a longer one', () => {
    expect(geoEmptyCopy({ level: 'country', target: world, rangeDays: 7, parentVisitors: 0 })).toMatchObject({
      title: 'No visits in this range',
      offerLongerRange: true,
      illustration: 'map',
    });
    expect(geoEmptyCopy({ level: 'country', target: world, rangeDays: 30, parentVisitors: 0 })).toMatchObject({
      title: 'No locations yet',
      body: 'Locations come from visits. None in this range.',
      offerLongerRange: false,
    });
  });

  it('drilled level: no visits from the place vs. no region or city data', () => {
    expect(geoEmptyCopy({ level: 'region', target: { country: 'PK', region: null }, rangeDays: 1, parentVisitors: 0 }).title).toBe(
      'No visits from Pakistan in this range',
    );
    expect(geoEmptyCopy({ level: 'city', target: { country: 'PK', region: 'PB' }, rangeDays: 90, parentVisitors: 0 })).toMatchObject({
      title: 'No visits from PB, Pakistan in this range',
      offerLongerRange: false,
    });
    expect(geoEmptyCopy({ level: 'region', target: { country: 'PK', region: null }, rangeDays: 7, parentVisitors: 4 }).title).toBe(
      'No region data for this country',
    );
    expect(geoEmptyCopy({ level: 'city', target: { country: 'PK', region: 'PB' }, rangeDays: 7, parentVisitors: 4 }).title).toBe(
      'No city data for this region',
    );
  });
});
