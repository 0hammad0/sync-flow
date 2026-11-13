import { describe, expect, it } from 'vitest';

import {
  addDays,
  daysBetween,
  formatDaySpan,
  isIsoDay,
  rangeToParams,
  resolveRange,
  spanDays,
  type RangeParams,
} from '@/features/admin/analytics/range';
import { parseRangeParams } from '@/features/admin/analytics/range-schema';
import { usesDateRange } from '@/features/admin/shell/nav';

const today = '2026-11-14';
const none: RangeParams = { range: null, from: null, to: null };
const at = (p: Partial<RangeParams>, options: { retentionDays?: number } = {}) =>
  resolveRange({ ...none, ...p }, { today, ...options });

describe('range presets', () => {
  it('defaults to 7d: 7 UTC days ending today, by day', () => {
    expect(at({})).toEqual({ kind: '7d', from: '2026-11-08', to: today, days: 7, granularity: 'day', clamped: false });
  });

  it('today and 24h are hourly; 30d and 90d count today', () => {
    expect(at({ range: 'today' })).toMatchObject({ from: today, to: today, days: 1, granularity: 'hour' });
    expect(at({ range: '24h' })).toMatchObject({ from: '2026-11-13', to: today, days: 2, granularity: 'hour' });
    expect(at({ range: '30d' })).toMatchObject({ from: '2026-10-16', days: 30, granularity: 'day' });
    expect(at({ range: '90d' })).toMatchObject({ from: '2026-08-17', days: 90 });
  });
});

describe('custom ranges', () => {
  it('keeps a valid range and treats from/to without range as custom', () => {
    const r = at({ range: 'custom', from: '2026-11-01', to: '2026-11-03' });
    expect(r).toEqual({ kind: 'custom', from: '2026-11-01', to: '2026-11-03', days: 3, granularity: 'day', clamped: false });
    expect(at({ from: '2026-11-01', to: '2026-11-03' }).kind).toBe('custom');
  });

  it('swaps from > to without marking it clamped', () => {
    expect(at({ range: 'custom', from: '2026-11-05', to: '2026-11-01' })).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-05',
      clamped: false,
    });
  });

  it('cuts future days to today, and falls back when the whole range is in the future', () => {
    expect(at({ range: 'custom', from: '2026-11-10', to: '2026-12-01' })).toMatchObject({ to: today, clamped: true });
    expect(at({ range: 'custom', from: '2026-12-01', to: '2026-12-05' }).kind).toBe('7d');
  });

  it('cuts a span over 365 days, keeping the end', () => {
    const r = at({ range: 'custom', from: '2024-01-01', to: '2026-11-01' });
    expect(r).toMatchObject({ from: '2025-11-02', to: '2026-11-01', days: 365, clamped: true });
  });
});

describe('retention clamp', () => {
  it('starts presets and custom ranges at the retention window', () => {
    expect(at({ range: '90d' }, { retentionDays: 30 })).toMatchObject({ from: '2026-10-16', days: 30, clamped: true });
    expect(at({ range: 'custom', from: '2026-01-01', to: '2026-11-01' }, { retentionDays: 90 })).toMatchObject({
      from: '2026-08-17',
      to: '2026-11-01',
      clamped: true,
    });
  });

  it('falls back to 7d when the custom range ends before the window', () => {
    expect(at({ range: 'custom', from: '2025-01-01', to: '2025-01-10' }, { retentionDays: 90 }).kind).toBe('7d');
  });
});

describe('bad input → 7d', () => {
  it.each([
    [{ range: 'custom', from: '2026-02-30', to: '2026-03-01' }],
    [{ range: 'custom', from: 'yesterday', to: '2026-11-01' }],
    [{ range: 'custom', from: null, to: '2026-11-01' }],
  ] as const)('%j', (p) => {
    expect(at(p as Partial<RangeParams>).kind).toBe('7d');
  });

  it('the zod schema turns junk into nulls, never throws', () => {
    expect(parseRangeParams({ range: 'yearly', from: '2026-13-01', to: ['2026-11-01', 'x'] })).toEqual({
      range: null,
      from: null,
      to: '2026-11-01',
    });
    expect(parseRangeParams({ range: ['30d'] })).toEqual({ range: '30d', from: null, to: null });
    expect(parseRangeParams(undefined)).toEqual(none);
    expect(resolveRange(parseRangeParams({ range: '1y' }), { today }).kind).toBe('7d');
  });
});

describe('day helpers', () => {
  it('validates, adds and counts UTC days', () => {
    expect(isIsoDay('2028-02-29')).toBe(true);
    expect(isIsoDay('2026-02-29')).toBe(false);
    expect(isIsoDay('2026-1-01')).toBe(false);
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(spanDays('2026-11-01', '2026-11-01')).toBe(1);
    expect(spanDays('2026-11-02', '2026-11-01')).toBe(0);
    expect(daysBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('formats spans and round-trips URL params', () => {
    expect(formatDaySpan('2026-11-08', '2026-11-14')).toBe('8 Nov – 14 Nov 2026');
    expect(formatDaySpan('2025-12-30', '2026-01-02')).toBe('30 Dec 2025 – 2 Jan 2026');
    expect(rangeToParams(at({ range: '30d' }))).toEqual({ range: '30d' });
    expect(rangeToParams(at({ from: '2026-11-01', to: '2026-11-02' }))).toEqual({
      range: 'custom',
      from: '2026-11-01',
      to: '2026-11-02',
    });
  });
});

describe('picker placement', () => {
  it('shows on range screens only: not on Live, detail pages or non-analytics pages', () => {
    for (const p of ['/admin', '/admin/', '/admin/sessions', '/admin/pages', '/admin/geography', '/admin/sources']) {
      expect(usesDateRange(p)).toBe(true);
    }
    for (const p of ['/admin/live', '/admin/sessions/abc', '/admin/files', '/admin/health', '/admin/settings', null]) {
      expect(usesDateRange(p)).toBe(false);
    }
  });
});
