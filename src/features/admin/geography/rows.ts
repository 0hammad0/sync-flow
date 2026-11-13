// Breakdown rows → Geography table rows, plus sort, paging and the map data.
// Pure: the server page runs it, the tests feed it plain DTOs.
import type { BreakdownRow } from '@/features/admin/analytics/types';
import { formatShare } from '@/shared/ui/charts/format';
import type { SortConfig } from '@/shared/ui/data-table/url-state';
import { UNKNOWN_REGION, parseRegionParam, placeCountryName, type GeoLevel, type GeoTarget } from './drill';

export type GeoRow = {
  /** Unique within one level. */
  id: string;
  /** What the place cell shows: country name, region code, city name, "Unknown", "Other places". */
  label: string;
  /** Country rows: the ISO code shown before the name. */
  code: string | null;
  /** Where a click goes. Null: city rows, "Other places", and keys that cannot be a URL param. */
  drill: GeoTarget | null;
  /** "Unknown" (no country / region / city in the visit). */
  unknown: boolean;
  /** The long tail the daily build folded together. */
  other: boolean;
  visitors: number;
  pageviews: number;
  /** Seconds, for the chart kit's duration format. */
  avgTimeS: number | null;
  /** 0..100. */
  bouncePct: number | null;
  /** Visitors / all visitors of the listed level, 0..1. */
  share: number;
};

/** Geography pages at 50 rows (07-geography.md edge case 6). */
export const GEO_PAGE_SIZE = 50;

/** Every column sorts: the rows are in memory (one rollup read per level), not a Firestore query. */
export const GEO_SORT: SortConfig = {
  allowed: ['place', 'visitors', 'pageviews', 'avg_time', 'bounce'],
  default: '-visitors',
};

/**
 * Defensive decode of a place name. Ingest already decodes Vercel's
 * URL-encoded city header (`S%C3%A3o%20Paulo`), but rows written before that
 * fix, or a double-encoded value, would otherwise show `%` codes.
 */
export function decodePlaceName(value: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(value)) return value;
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/**
 * Table rows of one level. `target` is the level's own place (the country of
 * the regions, the region of the cities). At city level with the unknown
 * region, `rows` are all cities of the country and only those without a
 * region are kept.
 */
export function toGeoRows(rows: BreakdownRow[], level: GeoLevel, target: GeoTarget): GeoRow[] {
  const kept =
    level === 'city' && target.region === UNKNOWN_REGION ? rows.filter((r) => r.other || r.region === null) : rows;
  const total = kept.reduce((sum, r) => sum + r.visitors, 0);
  return kept.map((r) => {
    const unknown = !r.other && r.key === null;
    return {
      id: rowId(level, r),
      label: labelOf(r, level),
      code: level === 'country' && !r.other ? r.key : null,
      drill: drillOf(r, level, target),
      unknown,
      other: r.other,
      visitors: r.visitors,
      pageviews: r.pageviews,
      avgTimeS: r.avgEngagedMs === null ? null : r.avgEngagedMs / 1000,
      bouncePct: r.bounceRate === null ? null : r.bounceRate * 100,
      share: total > 0 ? r.visitors / total : 0,
    };
  });
}

function rowId(level: GeoLevel, r: BreakdownRow): string {
  if (r.other) return '_other';
  if (level === 'city') return `${r.region ?? ''}|${r.key ?? ''}`;
  return r.key ?? '_unknown';
}

function labelOf(r: BreakdownRow, level: GeoLevel): string {
  if (r.other) return 'Other places';
  if (r.key === null) return 'Unknown';
  if (level === 'country') return placeCountryName(r.key);
  return decodePlaceName(r.key);
}

function drillOf(r: BreakdownRow, level: GeoLevel, target: GeoTarget): GeoTarget | null {
  if (r.other || level === 'city') return null;
  if (level === 'country') return r.key ? { country: r.key, region: null } : null;
  // Region rows: the unknown region still has cities worth seeing.
  if (!target.country) return null;
  if (r.key === null) return { country: target.country, region: UNKNOWN_REGION };
  const region = parseRegionParam(r.key);
  return region && region !== UNKNOWN_REGION ? { country: target.country, region } : null;
}

type SortKey = (row: GeoRow) => number | string | null;

const SORT_KEYS: Record<string, SortKey> = {
  place: (r) => r.label,
  visitors: (r) => r.visitors,
  pageviews: (r) => r.pageviews,
  avg_time: (r) => r.avgTimeS,
  bounce: (r) => r.bouncePct,
};

/** `?sort=` value → rows in that order. "Other places" stays last; empty values sort last both ways. */
export function sortGeoRows(rows: GeoRow[], sort: string): GeoRow[] {
  const desc = sort.startsWith('-');
  const id = desc ? sort.slice(1) : sort;
  const key = SORT_KEYS[id] ?? SORT_KEYS.visitors;
  const dir = SORT_KEYS[id] ? (desc ? -1 : 1) : -1;
  return [...rows].sort((a, b) => {
    if (a.other !== b.other) return a.other ? 1 : -1;
    const x = key(a);
    const y = key(b);
    if (x === null || y === null) {
      if (x !== y) return x === null ? 1 : -1;
    } else if (x !== y) {
      const cmp = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : (x as number) - (y as number);
      if (cmp !== 0) return cmp * dir;
    }
    // Ties: more visitors first, then by name, so the order never jumps.
    return b.visitors - a.visitors || a.label.localeCompare(b.label);
  });
}

/** `?cursor=` is the row offset of the page. Junk or out of range → first page. */
export function parseOffset(cursor: string | null | undefined, total: number): number {
  if (!cursor || !/^\d{1,6}$/.test(cursor)) return 0;
  const offset = Number(cursor);
  return offset < total && offset % GEO_PAGE_SIZE === 0 ? offset : 0;
}

export type GeoPage = {
  rows: GeoRow[];
  /** DataTable `page`: '' (FIRST_PAGE_CURSOR) when the newer page is the first. */
  prevCursor: string | null;
  nextCursor: string | null;
  total: number;
};

export function pageGeoRows(rows: GeoRow[], cursor: string | null | undefined): GeoPage {
  const offset = parseOffset(cursor, rows.length);
  const next = offset + GEO_PAGE_SIZE;
  return {
    rows: rows.slice(offset, next),
    prevCursor: offset === 0 ? null : offset - GEO_PAGE_SIZE === 0 ? '' : String(offset - GEO_PAGE_SIZE),
    nextCursor: next < rows.length ? String(next) : null,
    total: rows.length,
  };
}

/** WorldMap data: located countries only ("Unknown" and "Other places" stay in the table). */
export function mapDataOf(rows: BreakdownRow[]): { country: string; value: number }[] {
  return rows.filter((r) => !r.other && r.key !== null && r.visitors > 0).map((r) => ({ country: r.key!, value: r.visitors }));
}

/** Screen-reader sentence for the map: "Top countries: Pakistan 47%, United States 16%." (top 5). */
export function mapSummaryOf(rows: BreakdownRow[], total: number): string {
  const top = mapDataOf(rows)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .map((d) => `${placeCountryName(d.country)} ${formatShare(d.value, total)}`);
  return top.length ? `World map of visitors. Top countries: ${top.join(', ')}.` : 'World map of visitors. No located visits.';
}
