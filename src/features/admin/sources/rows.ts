import type { BreakdownRow, SampleShareRow } from '@/features/admin/analytics/types';
import { pagePathLabel } from '@/features/admin/pages/constants';
import type { BarListItem } from '@/shared/ui/charts/BarList';
import type { DonutPart } from '@/shared/ui/charts/Donut';
import { FIRST_PAGE_CURSOR } from '@/shared/ui/data-table/url-state';
import {
  DIRECT_HOST,
  DRILL_PARAM,
  OTHER_KEY,
  SOURCE_SORT,
  SOURCES_PAGE_SIZE,
  type SourceDimKey,
  type SourceSortKey,
  type SourceTab,
} from './constants';

// Pure: breakdown rows → one page of the Sources table, the donut parts and
// the drill keys. The data layer already labels the buckets ("Direct / none",
// "(not set)", "Unknown", "Other"); this keeps them last and muted.

export type SourceTableRow = BreakdownRow & {
  /** Stable row id (`key` may be null). */
  id: string;
  /** The fold bucket or the null bucket: shown muted. */
  bucket: boolean;
  /** `?host=` / `?browser=` value that opens this row's drill, or null when it has none. */
  drillKey: string | null;
  /** `https://host` for a referrer that is a real web host, else null. */
  externalUrl: string | null;
};

const WEB_HOST = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}$/i;

/** A referrer host worth an "open site" link: a dotted host name, not an IP or `localhost`. */
export function isWebHost(host: string | null): host is string {
  if (!host || !WEB_HOST.test(host)) return false;
  return !/^\d+(\.\d+){3}$/.test(host);
}

function isOther(row: Pick<BreakdownRow, 'key' | 'other'>): boolean {
  return row.other || row.key === OTHER_KEY;
}

export function drillKeyFor(tab: SourceTab, row: Pick<BreakdownRow, 'key' | 'other'>): string | null {
  const param = DRILL_PARAM[tab];
  if (!param || isOther(row)) return null;
  if (row.key === null) return param === 'host' ? DIRECT_HOST : null;
  return row.key;
}

/** `?host=` → the referrer host to drill into: `null` = direct. */
export function hostFromParam(value: string): string | null {
  return value === DIRECT_HOST ? null : value;
}

export function toSourceRow(tab: SourceTab, row: BreakdownRow): SourceTableRow {
  const other = isOther(row);
  return {
    ...row,
    id: other ? OTHER_KEY : row.key === null ? '(none)' : `k:${row.key}`,
    bucket: other || row.key === null,
    drillKey: drillKeyFor(tab, row),
    externalUrl: tab === 'referrers' && !other && isWebHost(row.key) ? `https://${row.key}` : null,
  };
}

type SortValue = string | number | null;

function sortValue(row: BreakdownRow, key: SourceSortKey): SortValue {
  if (key === 'share') return row.sessions;
  if (key === 'label') return row.label.toLowerCase();
  return row[key];
}

/** Sort by one column; the buckets stay at the bottom, nulls go last, ties by sessions then label. */
export function sortSourceRows<T extends BreakdownRow>(rows: readonly T[], sort: string): T[] {
  const desc = sort.startsWith('-');
  const id = desc ? sort.slice(1) : sort;
  const key = ((SOURCE_SORT.allowed as readonly string[]).includes(id) ? id : 'visitors') as SourceSortKey;
  const rank = (r: BreakdownRow) => (isOther(r) ? 2 : r.key === null ? 1 : 0);
  return [...rows].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x !== y) {
      if (x === null) return 1;
      if (y === null) return -1;
      const cmp = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : x - y;
      if (cmp !== 0) return desc ? -cmp : cmp;
    }
    return b.sessions - a.sessions || a.label.localeCompare(b.label);
  });
}

export type SourceSelection = {
  rows: SourceTableRow[];
  total: number;
  /** Sessions of every row (share base). */
  totalSessions: number;
  prevCursor: string | null;
  nextCursor: string | null;
};

/** Sort → one page of 25. `cursor` is the row offset. */
export function selectSourceRows(
  tab: SourceTab,
  all: readonly BreakdownRow[],
  query: { sort: string; cursor: number },
): SourceSelection {
  const sorted = sortSourceRows(all, query.sort);
  const total = sorted.length;
  const lastStart = total === 0 ? 0 : Math.floor((total - 1) / SOURCES_PAGE_SIZE) * SOURCES_PAGE_SIZE;
  const start = Math.min(Math.max(0, Math.floor(query.cursor / SOURCES_PAGE_SIZE) * SOURCES_PAGE_SIZE), lastStart);
  const end = start + SOURCES_PAGE_SIZE;
  return {
    rows: sorted.slice(start, end).map((r) => toSourceRow(tab, r)),
    total,
    totalSessions: all.reduce((sum, r) => sum + r.sessions, 0),
    prevCursor: start === 0 ? null : start - SOURCES_PAGE_SIZE === 0 ? FIRST_PAGE_CURSOR : String(start - SOURCES_PAGE_SIZE),
    nextCursor: end < total ? String(end) : null,
  };
}

/** UTM tab with visits but not one tag: every row is "(not set)". */
export function hasNoTags(rows: readonly BreakdownRow[]): boolean {
  return rows.every((r) => r.key === null);
}

const DEVICE_ORDER = [
  { key: 'desktop', label: 'Desktop' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'tablet', label: 'Tablet' },
] as const;

/**
 * Donut parts in the palette's fixed order (09-charts-and-maps.md): devices are
 * desktop, mobile, tablet, then "Unknown" when any. Browsers and OS: the top
 * three by visitors, then "Other" for the rest (unknown and folded included).
 */
export function donutParts(dim: SourceDimKey, rows: readonly BreakdownRow[]): DonutPart[] {
  if (dim === 'device') {
    const known = DEVICE_ORDER.map((d) => ({ label: d.label, value: rows.find((r) => r.key === d.key)?.visitors ?? 0 }));
    const rest = rows.filter((r) => !DEVICE_ORDER.some((d) => d.key === r.key)).reduce((sum, r) => sum + r.visitors, 0);
    return rest > 0 ? [...known, { label: 'Unknown', value: rest }] : known;
  }
  const named = [...rows].filter((r) => r.key !== null && !isOther(r)).sort((a, b) => b.visitors - a.visitors);
  const top = named.slice(0, 3);
  const rest = rows.filter((r) => !top.includes(r)).reduce((sum, r) => sum + r.visitors, 0);
  const parts = top.map((r) => ({ label: r.label, value: r.visitors }));
  return rest > 0 ? [...parts, { label: 'Other', value: rest }] : parts;
}

/** Long values (campaign names) cut to `max` characters with an ellipsis. */
export function truncateLabel(label: string, max: number): string {
  const chars = Array.from(label);
  return chars.length <= max ? label : `${chars.slice(0, max - 1).join('')}…`;
}

/** "google.com", "Direct / none" or "Chrome". */
export function drillSubject(tab: SourceTab, drill: string): string {
  if (tab === 'referrers') return hostFromParam(drill) ?? 'Direct / none';
  return drill;
}

/** Entry pages: the path ("Unknown page" when missing). Versions: "Chrome 131" ("Unknown version"). */
export function drillItems(tab: SourceTab, drill: string, rows: SampleShareRow[]): BarListItem[] {
  return rows.map((row) => ({
    label:
      tab === 'browsers'
        ? row.key === null
          ? 'Unknown version'
          : `${drill} ${row.key}`
        : row.key === null
          ? 'Unknown page'
          : pagePathLabel(row.key),
    value: row.count,
  }));
}
