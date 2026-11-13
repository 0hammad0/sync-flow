import 'server-only';

import type { CityStats, DimStats, PathStats, Rollup } from '@/server/analytics/model';
import { FOLD_KEY, UNKNOWN_KEY, decodeKey } from '@/server/firestore/encode-key';
import type { BreakdownDim, BreakdownRow, Kpis, PageRow, TrendPoint } from './dto';
import { slotStart, type SlotTotals } from './rollup-window';

/** Pure maths from merged rollups to screen rows. No I/O. */

type Totals = Pick<Rollup, 'views' | 'sessions' | 'bounces' | 'engaged_ms'>;

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export function kpisOf(r: Totals): Kpis {
  return {
    visitors: r.sessions,
    sessions: r.sessions,
    pageviews: r.views,
    avgEngagedMs: ratio(r.engaged_ms, r.sessions),
    bounceRate: ratio(r.bounces, r.sessions),
  };
}

/** One point per current slot, paired with the previous period's slot at the same position. */
export function trendPoints(current: SlotTotals[], previous: SlotTotals[]): TrendPoint[] {
  return current.map((slot, i) => {
    const prev = previous[i] ?? null;
    return {
      key: slot.key,
      start: slotStart(slot.key),
      visitors: slot.sessions,
      pageviews: slot.views,
      prevKey: prev?.key ?? null,
      prevVisitors: prev?.sessions ?? 0,
      prevPageviews: prev?.views ?? 0,
      sampled: slot.sampled,
      missing: slot.missing,
    };
  });
}

const DEVICE_LABELS: Record<string, string> = { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet' };

let regionNames: Intl.DisplayNames | null = null;

/** English country name for an ISO code; the code itself when unknown to Intl (`XK`). */
export function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

function emptyLabel(dim: BreakdownDim): string {
  if (dim === 'referrer') return 'Direct / none';
  if (dim.startsWith('utm_')) return '(not set)';
  return 'Unknown';
}

function otherLabel(dim: BreakdownDim): string {
  return dim === 'country' || dim === 'region' || dim === 'city' ? 'Other places' : 'Other';
}

type Parsed = { key: string | null; label: string; country: string | null; region: string | null };

/** Decoded parts of a map key. `null` key = the "(none)" bucket. */
function parseKey(dim: BreakdownDim, raw: string): Parsed | 'other' {
  if (raw === FOLD_KEY) return 'other';
  const none = { key: null, label: emptyLabel(dim), country: null, region: null };
  if (raw === UNKNOWN_KEY) return none;
  const value = decodeKey(raw);
  if (dim === 'country') {
    const code = value.toUpperCase();
    // XX is Vercel's "unknown": same row as a missing country.
    return code === 'XX' ? none : { key: code, label: countryName(code), country: code, region: null };
  }
  if (dim === 'region') {
    const [country = '', ...rest] = value.split(':');
    const region = rest.join(':');
    return { key: region || null, label: region || 'Unknown', country: country || null, region: region || null };
  }
  if (dim === 'city') {
    const [country = '', region = '', ...rest] = value.split(':');
    const city = rest.join(':');
    return { key: city || null, label: city || 'Unknown', country: country || null, region: region || null };
  }
  if (dim === 'device') return { key: value, label: DEVICE_LABELS[value] ?? value, country: null, region: null };
  return { key: value, label: value, country: null, region: null };
}

export type BreakdownOptions = {
  /** Region / city levels: only keys of this country. */
  country?: string | null;
  /** City level: only keys of this region. */
  region?: string | null;
};

function bySessions(a: BreakdownRow, b: BreakdownRow): number {
  if (a.other !== b.other) return a.other ? 1 : -1;
  return b.sessions - a.sessions || b.pageviews - a.pageviews || a.label.localeCompare(b.label);
}

/**
 * Rows of one breakdown map, sessions desc, `_other` last. Same keys after
 * decoding (`XX` and `(none)` countries) are merged into one row. Filtered
 * levels (regions of a country, cities of a region) leave out `_other`: the
 * fold bucket has no country.
 */
export function breakdownRows(r: Rollup, dim: BreakdownDim, options: BreakdownOptions = {}): BreakdownRow[] {
  const map = r[dim] as Record<string, DimStats | CityStats>;
  const filtered = Boolean(options.country) || Boolean(options.region);
  const rows = new Map<string, BreakdownRow>();
  for (const [raw, stats] of Object.entries(map)) {
    const parsed = parseKey(dim, raw);
    if (parsed === 'other' && filtered) continue;
    if (parsed !== 'other') {
      if (options.country && parsed.country !== options.country.toUpperCase()) continue;
      if (options.region && parsed.region !== options.region) continue;
    }
    const id = parsed === 'other' ? FOLD_KEY : `${parsed.country ?? ''}|${parsed.region ?? ''}|${parsed.key ?? ''}`;
    const row: BreakdownRow =
      rows.get(id) ??
      (parsed === 'other'
        ? { ...blankRow(), key: FOLD_KEY, label: otherLabel(dim), other: true }
        : { ...blankRow(), key: parsed.key, label: parsed.label, country: parsed.country, region: parsed.region });
    row.sessions += stats.sessions;
    row.pageviews += stats.views;
    row.avgEngagedMs = (row.avgEngagedMs ?? 0) + stats.engaged_ms;
    row.bounceRate = (row.bounceRate ?? 0) + stats.bounces;
    if ('lat' in stats && row.lat === null && stats.lat !== null) {
      row.lat = stats.lat;
      row.lon = stats.lon;
    }
    rows.set(id, row);
  }
  const list = [...rows.values()];
  const total = list.reduce((sum, row) => sum + row.sessions, 0);
  for (const row of list) {
    // avgEngagedMs / bounceRate held the sums until here.
    row.visitors = row.sessions;
    row.avgEngagedMs = ratio(row.avgEngagedMs ?? 0, row.sessions);
    row.bounceRate = ratio(row.bounceRate ?? 0, row.sessions);
    row.share = ratio(row.sessions, total) ?? 0;
  }
  return list.sort(bySessions);
}

function blankRow(): BreakdownRow {
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
  };
}

/** Per-path stats, views desc, `_other` last. */
export function pageRows(r: Rollup): PageRow[] {
  const entries = Object.entries(r.path) as [string, PathStats][];
  const totalViews = entries.reduce((sum, [, s]) => sum + s.views, 0);
  return entries
    .map(([raw, s]): PageRow => {
      const other = raw === FOLD_KEY;
      const path = other ? FOLD_KEY : decodeKey(raw);
      return {
        path,
        label: other ? 'Other pages' : path,
        other,
        pageviews: s.views,
        visitors: s.sessions,
        sessions: s.sessions,
        entries: s.entries,
        exits: s.exits,
        avgEngagedMs: ratio(s.engaged_ms, s.views),
        bounceRate: ratio(s.bounces, s.entries),
        exitRate: ratio(s.exits, s.views),
        avgScroll: ratio(s.scroll_sum, s.views),
        share: ratio(s.views, totalViews) ?? 0,
      };
    })
    .sort((a, b) => (a.other !== b.other ? (a.other ? 1 : -1) : b.pageviews - a.pageviews || a.path.localeCompare(b.path)));
}
