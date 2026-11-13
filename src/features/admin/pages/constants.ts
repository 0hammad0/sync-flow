import { ROUTE_PATTERNS } from '@/features/tracking/routes';

// Pages screen constants (05-pages.md), zod-free so the client table can
// import them. schemas.ts builds the URL schema on these.

/** `?mode=`: every view, or only the pages sessions started / ended on. */
export const PAGE_MODES = ['entry', 'all', 'exit'] as const;
export type PageMode = (typeof PAGE_MODES)[number];

export const PAGE_MODE_LABELS: Record<PageMode, { tab: string; short: string }> = {
  entry: { tab: 'Entry pages', short: 'Entry' },
  all: { tab: 'All pages', short: 'All' },
  exit: { tab: 'Exit pages', short: 'Exit' },
};

/** Sortable column ids per mode. All sorting happens in memory on the merged rollup rows. */
export const PAGE_SORTS: Record<PageMode, { allowed: readonly PageSortKey[]; default: string }> = {
  all: { allowed: ['path', 'pageviews', 'visitors', 'avgEngagedMs', 'bounceRate', 'exitRate', 'avgScroll'], default: '-pageviews' },
  entry: { allowed: ['path', 'entries', 'pageviews', 'avgEngagedMs', 'bounceRate', 'avgScroll'], default: '-entries' },
  exit: { allowed: ['path', 'exits', 'pageviews', 'avgEngagedMs', 'exitRate', 'avgScroll'], default: '-exits' },
};

export type PageSortKey =
  | 'path'
  | 'pageviews'
  | 'visitors'
  | 'entries'
  | 'exits'
  | 'avgEngagedMs'
  | 'bounceRate'
  | 'exitRate'
  | 'avgScroll';

/** The count each mode is about: the bar under it and the empty-row filter use it. */
export const PRIMARY_METRIC: Record<PageMode, 'pageviews' | 'entries' | 'exits'> = {
  all: 'pageviews',
  entry: 'entries',
  exit: 'exits',
};

/** 25 rows per page, "Next 25" over the in-memory list (no extra reads). */
export const PAGES_PAGE_SIZE = 25;

/** The cron's fold bucket and the "no path" key, as they come out of the rollup map. */
export const OTHER_PATH = '_other';
export const NONE_PATH = '(none)';

/** Plain words for the two buckets that are not real paths. */
export function pagePathLabel(path: string): string {
  if (path === OTHER_PATH) return 'Other pages';
  if (path === NONE_PATH) return 'Unknown page';
  return path;
}

/** A real, tracked route pattern: the only `?path=` values the detail panel queries. */
export function isKnownPath(path: string | null | undefined): path is string {
  return typeof path === 'string' && (ROUTE_PATTERNS as readonly string[]).includes(path);
}

export const AVG_TIME_HINT = 'Time the tab was visible. Idle over 30 s is not counted.';
export const VISITORS_HINT = 'Counted per browser tab session.';
