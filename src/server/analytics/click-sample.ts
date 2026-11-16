import type { SessionDoc } from '@/server/analytics/model';

/**
 * The clicks of the newest ≤ 500 sessions in a compact, JSON-safe shape, so
 * one sample sits in the Next data cache (2 MB per entry) and every filter
 * (path, viewport, rage / dead) runs in memory on it (06-clicks.md "Data").
 *
 * Strings are stored once (`paths`, `targets`, `labels`); each click is
 * CLICK_STRIDE numbers in `rows`:
 * `[session, path, target, label (-1 = none), x_pct × 10, y_px, doc_h, vw (0 sm, 1 md, 2 lg), kind (0 click, 1 rage, 2 dead), ts (s)]`.
 * At most `maxPoints` clicks (newest sessions first): 20,000 × 10 small
 * numbers stays well under the cache limit.
 */

export const CLICK_STRIDE = 10;
export const CLICK_SAMPLE_MAX_POINTS = 20_000;
export const VW_INDEX = { sm: 0, md: 1, lg: 2 } as const;

export type ClickSample = {
  /** Sessions in the sample (all read, unless the point cap stopped it early). */
  sessions: number;
  /** Stopped at `maxPoints`. */
  truncated: boolean;
  /** Session ids by sample index (rage / dead rows link to one). */
  ids: string[];
  paths: string[];
  targets: string[];
  labels: string[];
  /** Page views per path in the same sessions (the share-of-views denominator). */
  pageviews: Record<string, number>;
  rows: number[];
};

export const EMPTY_CLICK_SAMPLE: ClickSample = {
  sessions: 0,
  truncated: false,
  ids: [],
  paths: [],
  targets: [],
  labels: [],
  pageviews: {},
  rows: [],
};

function interner(list: string[]): (value: string) => number {
  const index = new Map<string, number>();
  return (value) => {
    let i = index.get(value);
    if (i === undefined) {
      i = list.length;
      list.push(value);
      index.set(value, i);
    }
    return i;
  };
}

export function toClickSample(docs: readonly SessionDoc[], maxPoints = CLICK_SAMPLE_MAX_POINTS): ClickSample {
  const out: ClickSample = { sessions: 0, truncated: false, ids: [], paths: [], targets: [], labels: [], pageviews: {}, rows: [] };
  const path = interner(out.paths);
  const target = interner(out.targets);
  const label = interner(out.labels);
  let points = 0;
  for (const [s, doc] of docs.entries()) {
    if (points >= maxPoints) {
      out.truncated = true;
      break;
    }
    out.sessions = s + 1;
    out.ids.push(doc.id);
    for (const page of Object.values(doc.pages)) {
      if (page.path) out.pageviews[page.path] = (out.pageviews[page.path] ?? 0) + 1;
    }
    for (const c of doc.clicks) {
      if (points >= maxPoints) {
        out.truncated = true;
        break;
      }
      points += 1;
      out.rows.push(
        s,
        path(c.path),
        target(c.target),
        c.label ? label(c.label) : -1,
        Math.round(c.x_pct * 10),
        Math.round(c.y_px),
        Math.round(c.doc_h),
        VW_INDEX[c.vw_bucket] ?? 2,
        c.rage ? 1 : c.dead ? 2 : 0,
        Math.floor(c.ts.getTime() / 1000),
      );
    }
  }
  return out;
}
