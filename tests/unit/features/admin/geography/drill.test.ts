import { describe, expect, it } from 'vitest';
import {
  UNKNOWN_REGION,
  crumbsFor,
  geoHref,
  levelOf,
  parentOf,
  parseCountryParam,
  parseGeoTarget,
  parseRegionParam,
} from '@/features/admin/geography/drill';
import { parseGeoParams } from '@/features/admin/geography/schemas';

describe('parseCountryParam', () => {
  it('upper-cases a real alpha-2 code', () => {
    expect(parseCountryParam('pk')).toBe('PK');
    expect(parseCountryParam(' US ')).toBe('US');
    expect(parseCountryParam(['DE', 'FR'])).toBe('DE');
  });

  it('keeps Kosovo, which Vercel sends', () => {
    expect(parseCountryParam('XK')).toBe('XK');
  });

  it('falls back to world level for anything else', () => {
    for (const value of ['XX', 'ZZ', 'EU', 'PAK', 'P', '12', '', null, undefined, 42, {}]) {
      expect(parseCountryParam(value)).toBeNull();
    }
  });
});

describe('parseRegionParam', () => {
  it('keeps ISO 3166-2 suffixes as sent', () => {
    expect(parseRegionParam('PB')).toBe('PB');
    expect(parseRegionParam('ca')).toBe('ca');
    expect(parseRegionParam('01')).toBe('01');
    expect(parseRegionParam('NL-NH')).toBe('NL-NH');
  });

  it('accepts the unknown-region marker', () => {
    expect(parseRegionParam(UNKNOWN_REGION)).toBe(UNKNOWN_REGION);
  });

  it('drops separators, spaces and long values', () => {
    for (const value of ['PK:PB', 'a b', '_other', '<script>', 'ABCDEFGHIJ', '', null]) {
      expect(parseRegionParam(value)).toBeNull();
    }
  });
});

describe('parseGeoTarget and levels', () => {
  it('ignores a region without a country', () => {
    expect(parseGeoTarget({ region: 'PB' })).toEqual({ country: null, region: null });
    expect(parseGeoTarget({ country: 'XX', region: 'PB' })).toEqual({ country: null, region: null });
  });

  it('maps a target to the level the table lists', () => {
    expect(levelOf({ country: null, region: null })).toBe('country');
    expect(levelOf({ country: 'PK', region: null })).toBe('region');
    expect(levelOf({ country: 'PK', region: 'PB' })).toBe('city');
  });

  it('goes one level up', () => {
    expect(parentOf({ country: 'PK', region: 'PB' })).toEqual({ country: 'PK', region: null });
    expect(parentOf({ country: 'PK', region: null })).toEqual({ country: null, region: null });
    expect(parentOf({ country: null, region: null })).toBeNull();
  });
});

describe('crumbsFor', () => {
  it('names every level, the last one current', () => {
    expect(crumbsFor({ country: 'PK', region: 'PB' })).toEqual([
      { label: 'All countries', target: { country: null, region: null }, current: false },
      { label: 'Pakistan', target: { country: 'PK', region: null }, current: false },
      { label: 'PB', target: { country: 'PK', region: 'PB' }, current: true },
    ]);
    expect(crumbsFor({ country: null, region: null })).toEqual([
      { label: 'All countries', target: { country: null, region: null }, current: true },
    ]);
    expect(crumbsFor({ country: 'PK', region: UNKNOWN_REGION }).at(-1)?.label).toBe('Unknown region');
  });
});

describe('geoHref', () => {
  it('keeps range, view and sort; drops the page cursor', () => {
    const current = 'range=custom&from=2026-11-01&to=2026-11-13&view=table&sort=-pageviews&cursor=50';
    expect(geoHref(current, { country: 'PK', region: null })).toBe(
      '/admin/geography?range=custom&from=2026-11-01&to=2026-11-13&view=table&sort=-pageviews&country=PK',
    );
  });

  it('replaces the old place and goes back to world level', () => {
    expect(geoHref('range=7d&country=PK&region=PB', { country: 'US', region: 'CA' })).toBe(
      '/admin/geography?range=7d&country=US&region=CA',
    );
    expect(geoHref('country=PK&region=PB', { country: null, region: null })).toBe('/admin/geography');
    expect(geoHref(new URLSearchParams('range=30d'), { country: null, region: 'PB' })).toBe('/admin/geography?range=30d');
  });
});

describe('parseGeoParams (server)', () => {
  it('reads country, region, sort and cursor', () => {
    expect(parseGeoParams({ country: 'pk', region: 'PB', sort: '-bounce', cursor: '50' })).toEqual({
      country: 'PK',
      region: 'PB',
      sort: '-bounce',
      cursor: '50',
    });
  });

  it('never fails: bad values fall back', () => {
    expect(parseGeoParams({ country: 'XX', region: 'PB', sort: 'started_at', cursor: '' })).toEqual({
      country: null,
      region: null,
      sort: '-visitors',
      cursor: null,
    });
    expect(parseGeoParams(undefined)).toEqual({ country: null, region: null, sort: '-visitors', cursor: null });
    expect(parseGeoParams({ country: ['US', 'PK'], sort: ['place'] })).toMatchObject({ country: 'US', sort: 'place' });
  });
});
