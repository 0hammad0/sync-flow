// Clicks screen DTOs (06-clicks.md "Data"). Plain types, no imports: the
// client ranking table and the lazy map import them for free.

export type VwBucket = 'sm' | 'md' | 'lg';
export type ClickKind = 'click' | 'rage' | 'dead';

/** One row of the element ranking: clicks grouped by target. */
export type ClickTargetDto = {
  target: string;
  /** Most common label of the target in the sample; null when every label was dropped. */
  label: string | null;
  clicks: number;
  /** Sessions in the sample that clicked it. */
  sessions: number;
  /** Sessions that clicked / page views of the path in the same sample (0–1). */
  shareOfViews: number;
  rage: number;
  dead: number;
  /** rage / clicks and dead / clicks (0–1); 0 without clicks. */
  ragePct: number;
  deadPct: number;
};

/** A dot on the map. `x` is 0–1 of the page width, `y` px from the top of a page `docH` tall. */
export type ClickPointDto = {
  x: number;
  y: number;
  docH: number;
  rage: boolean;
  dead: boolean;
  /** Index into the ranking's targets, -1 when the target is not listed. */
  target: number;
};

/** Rage or dead list row, grouped by path + target. */
export type RageDeadRowDto = {
  path: string;
  target: string;
  label: string | null;
  count: number;
  sessions: number;
  lastAt: string;
  /** The session with the latest of these events. */
  lastSessionId: string | null;
};

export type TrackedPathDto = {
  path: string;
  pageviews: number;
  /** Click totals of the path over the whole range (rollups), not the sample. */
  clicks: { total: number; rage: number; dead: number };
  /** Static page that can be framed safely for the map. */
  mapAllowed: boolean;
};

/** Shared header of every sample-based answer. */
export type ClickSampleMeta = {
  /** Sessions read (≤ 500). */
  sampleSessions: number;
  /** Click entries in the sample matching the filters. */
  sampleClicks: number;
  /** The sample stopped at its point cap. */
  truncated: boolean;
  /** Days the sample covers (the range's last 30 days at most). */
  from: string;
  to: string;
};
