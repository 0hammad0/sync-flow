import type { PageRow } from '@/features/admin/analytics/types';
import { FIRST_PAGE_CURSOR } from '@/shared/ui/data-table/url-state';
import {
  NONE_PATH,
  OTHER_PATH,
  PAGE_SORTS,
  PAGES_PAGE_SIZE,
  PRIMARY_METRIC,
  pagePathLabel,
  type PageMode,
  type PageSortKey,
} from './constants';

// Pure: rollup page rows → the rows of one table page. Search, mode, sort and
// paging all run in memory on the merged rows (05-pages.md "Paging"), so
// moving between pages costs no reads.

export type PageTableRow = PageRow & {
  /** Display text: the path, "Other pages" or "Unknown page". */
  label: string;
  /** False for the fold bucket and the no-path bucket: no detail panel. */
  linkable: boolean;
};

export type PageSelection = {
  rows: PageTableRow[];
  /** Rows after search and mode, before paging. */
  total: number;
  /** Largest primary count of all matching rows (bar scale). */
  max: number;
  /** Sum of the primary count over all rows of the mode (share base). */
  base: number;
  prevCursor: string | null;
  nextCursor: string | null;
};

export type PageQuery = { q: string; mode: PageMode; sort: string; cursor: number };

export function toTableRow(row: PageRow): PageTableRow {
  const bucket = row.other || row.path === OTHER_PATH || row.path === NONE_PATH;
  return { ...row, label: pagePathLabel(row.path), linkable: !bucket };
}

/**
 * Prefix match on the path, ignoring case. A leading `/` is implied, so
 * `chat` finds `/chat` and `/chat/[code]`. The two buckets never match a
 * search: they are not paths.
 */
export function matchesPath(row: PageRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (row.other || row.path === NONE_PATH) return false;
  const prefix = needle.startsWith('/') ? needle : `/${needle}`;
  return row.path.toLowerCase().startsWith(prefix);
}

type Sortable = Record<PageSortKey, string | number | null>;

function sortValue(row: PageRow, key: PageSortKey): string | number | null {
  return (row as unknown as Sortable)[key] ?? null;
}

/**
 * Sort by one column. Nulls (nothing to divide by) go last in both
 * directions; the buckets always stay at the bottom; ties fall back to
 * views, then path, so the order is stable between page loads.
 */
export function sortPageRows<T extends PageRow>(rows: readonly T[], sort: string): T[] {
  const desc = sort.startsWith('-');
  const key = (desc ? sort.slice(1) : sort) as PageSortKey;
  const bucket = (r: PageRow) => r.other || r.path === NONE_PATH;
  return [...rows].sort((a, b) => {
    if (bucket(a) !== bucket(b)) return bucket(a) ? 1 : -1;
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x !== y) {
      if (x === null) return 1;
      if (y === null) return -1;
      const cmp = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : x - y;
      if (cmp !== 0) return desc ? -cmp : cmp;
    }
    return b.pageviews - a.pageviews || a.path.localeCompare(b.path);
  });
}

/** A sort the mode allows, else the mode's default. */
export function sortForMode(mode: PageMode, sort: string | null | undefined): string {
  const { allowed, default: fallback } = PAGE_SORTS[mode];
  if (!sort) return fallback;
  const id = sort.startsWith('-') ? sort.slice(1) : sort;
  return (allowed as readonly string[]).includes(id) ? sort : fallback;
}

/** Search → mode → sort → one page of 25. `cursor` is the row offset. */
export function selectPageRows(all: readonly PageRow[], query: PageQuery): PageSelection {
  const metric = PRIMARY_METRIC[query.mode];
  const inMode = query.mode === 'all' ? all : all.filter((r) => r[metric] > 0);
  const base = inMode.reduce((sum, r) => sum + r[metric], 0);
  const matching = inMode.filter((r) => matchesPath(r, query.q));
  const sorted = sortPageRows(matching, sortForMode(query.mode, query.sort));
  const total = sorted.length;
  // An offset past the end (old link, data shrank) shows the last page.
  const lastStart = total === 0 ? 0 : Math.floor((total - 1) / PAGES_PAGE_SIZE) * PAGES_PAGE_SIZE;
  const start = Math.min(Math.max(0, Math.floor(query.cursor / PAGES_PAGE_SIZE) * PAGES_PAGE_SIZE), lastStart);
  const end = start + PAGES_PAGE_SIZE;
  return {
    rows: sorted.slice(start, end).map(toTableRow),
    total,
    max: matching.reduce((m, r) => Math.max(m, r[metric]), 0),
    base,
    prevCursor: start === 0 ? null : start - PAGES_PAGE_SIZE === 0 ? FIRST_PAGE_CURSOR : String(start - PAGES_PAGE_SIZE),
    nextCursor: end < total ? String(end) : null,
  };
}
