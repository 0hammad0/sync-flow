import type { BreakdownDim } from '@/features/admin/analytics/types';

// Sources screen constants (08-sources.md), zod-free so client components can
// import them. schemas.ts builds the URL schema on these.

export const SOURCE_TABS = ['referrers', 'utm', 'devices', 'browsers', 'os'] as const;
export type SourceTab = (typeof SOURCE_TABS)[number];

export const SOURCE_TAB_LABELS: Record<SourceTab, string> = {
  referrers: 'Referrers',
  utm: 'UTM',
  devices: 'Devices',
  browsers: 'Browsers',
  os: 'OS',
};

export const UTM_FIELDS = ['source', 'medium', 'campaign'] as const;
export type UtmField = (typeof UTM_FIELDS)[number];

export const UTM_FIELD_LABELS: Record<UtmField, string> = { source: 'Source', medium: 'Medium', campaign: 'Campaign' };

/** The rollup map a tab reads. Same union as `SourceDim` in the data layer. */
export type SourceDimKey = Extract<
  BreakdownDim,
  'referrer' | 'utm_source' | 'utm_medium' | 'utm_campaign' | 'device' | 'browser' | 'os'
>;

export function dimFor(tab: SourceTab, utm: UtmField): SourceDimKey {
  switch (tab) {
    case 'referrers':
      return 'referrer';
    case 'utm':
      return `utm_${utm}`;
    case 'devices':
      return 'device';
    case 'browsers':
      return 'browser';
    case 'os':
      return 'os';
  }
}

/** First column header per map. */
export const DIM_HEADERS: Record<SourceDimKey, string> = {
  referrer: 'Referrer',
  utm_source: 'UTM source',
  utm_medium: 'UTM medium',
  utm_campaign: 'UTM campaign',
  device: 'Device',
  browser: 'Browser',
  os: 'OS',
};

/** What the rows are, plural: table caption, card list name, "Loading …". */
export const DIM_PLURALS: Record<SourceDimKey, string> = {
  referrer: 'Referrers',
  utm_source: 'UTM sources',
  utm_medium: 'UTM mediums',
  utm_campaign: 'UTM campaigns',
  device: 'Devices',
  browser: 'Browsers',
  os: 'Operating systems',
};

/** Same ids as the CSV export's breakdown sort allowlist. `share` orders like visitors. */
export const SOURCE_SORT = {
  allowed: ['label', 'visitors', 'pageviews', 'bounceRate', 'share'] as const,
  default: '-visitors',
};
export type SourceSortKey = (typeof SOURCE_SORT.allowed)[number];

/** 25 rows per page over the in-memory list (no extra reads). */
export const SOURCES_PAGE_SIZE = 25;

/** `?host=` value for the "Direct / none" row (a real host never has parentheses). */
export const DIRECT_HOST = '(direct)';

/** The cron's fold bucket key. */
export const OTHER_KEY = '_other';

/** Long UTM values are cut on screen (full value in the tooltip). */
export const MAX_LABEL_CHARS = 60;

/** Tabs whose rows open a drill-down from the newest 500 sessions. */
export const DRILL_PARAM: Partial<Record<SourceTab, 'host' | 'browser'>> = { referrers: 'host', browsers: 'browser' };

/** Tabs that show the share donut (≥ 640 px). */
export const DONUT_TABS: readonly SourceTab[] = ['devices', 'browsers', 'os'];
