import { CLICK_STRIDE, VW_INDEX, type ClickSample } from '@/server/analytics/click-sample';
import { TARGET_LIMIT } from './constants';
import type { ClickKind, ClickPointDto, ClickTargetDto, RageDeadRowDto, VwBucket } from './types';

// Pure selection on a cached click sample (06-clicks.md "Data"): filter by
// path and viewport, then rank targets, list rage / dead, or emit map dots.

const KINDS: readonly ClickKind[] = ['click', 'rage', 'dead'];

/** One decoded click. */
export type ClickRow = {
  session: number;
  path: string;
  target: string;
  label: string | null;
  xPct: number;
  y: number;
  docH: number;
  vw: VwBucket;
  kind: ClickKind;
  ts: number;
};

const VW_BY_INDEX: readonly VwBucket[] = (Object.keys(VW_INDEX) as VwBucket[]).sort((a, b) => VW_INDEX[a] - VW_INDEX[b]);

export type ClickFilter = { path?: string | null; vw?: VwBucket | null };

/** Decodes the sample's clicks that match `path` and `vw` (null = any). */
export function selectClicks(sample: ClickSample, filter: ClickFilter = {}): ClickRow[] {
  const pathIndex = filter.path ? sample.paths.indexOf(filter.path) : null;
  if (pathIndex === -1) return [];
  const vwIndex = filter.vw ? VW_INDEX[filter.vw] : null;
  const out: ClickRow[] = [];
  const r = sample.rows;
  for (let i = 0; i + CLICK_STRIDE <= r.length; i += CLICK_STRIDE) {
    if (pathIndex !== null && r[i + 1] !== pathIndex) continue;
    if (vwIndex !== null && r[i + 7] !== vwIndex) continue;
    out.push({
      session: r[i],
      path: sample.paths[r[i + 1]] ?? '',
      target: sample.targets[r[i + 2]] ?? '',
      label: r[i + 3] >= 0 ? (sample.labels[r[i + 3]] ?? null) : null,
      xPct: r[i + 4] / 10,
      y: r[i + 5],
      docH: r[i + 6],
      vw: VW_BY_INDEX[r[i + 7]] ?? 'lg',
      kind: KINDS[r[i + 8]] ?? 'click',
      ts: r[i + 9] * 1000,
    });
  }
  return out;
}

function topLabel(counts: Map<string | null, number>): string | null {
  let best: string | null = null;
  let max = -1;
  for (const [label, n] of counts) {
    if (label !== null && (n > max || (n === max && best !== null && label < best))) {
      best = label;
      max = n;
    }
  }
  return best;
}

export type RankSort = 'clicks' | 'rage' | 'dead';

/**
 * Element ranking: clicks grouped by target. `pageviews` is the path's page
 * views in the same sample (share-of-views denominator).
 */
export function rankTargets(rows: readonly ClickRow[], pageviews: number, sort: RankSort = 'clicks', limit = TARGET_LIMIT): ClickTargetDto[] {
  type Acc = { clicks: number; rage: number; dead: number; sessions: Set<number>; labels: Map<string | null, number> };
  const groups = new Map<string, Acc>();
  for (const row of rows) {
    let g = groups.get(row.target);
    if (!g) {
      g = { clicks: 0, rage: 0, dead: 0, sessions: new Set(), labels: new Map() };
      groups.set(row.target, g);
    }
    g[row.kind === 'click' ? 'clicks' : row.kind] += 1;
    if (row.kind === 'click') {
      g.sessions.add(row.session);
      g.labels.set(row.label, (g.labels.get(row.label) ?? 0) + 1);
    }
  }
  const list: ClickTargetDto[] = [...groups.entries()].map(([target, g]) => ({
    target,
    label: topLabel(g.labels),
    clicks: g.clicks,
    sessions: g.sessions.size,
    shareOfViews: pageviews > 0 ? Math.min(1, g.sessions.size / pageviews) : 0,
    rage: g.rage,
    dead: g.dead,
    ragePct: g.clicks > 0 ? Math.min(1, g.rage / g.clicks) : 0,
    deadPct: g.clicks > 0 ? Math.min(1, g.dead / g.clicks) : 0,
  }));
  return list
    .filter((t) => (sort === 'clicks' ? t.clicks > 0 : t[sort] > 0))
    .sort((a, b) => b[sort] - a[sort] || b.clicks - a.clicks || a.target.localeCompare(b.target))
    .slice(0, limit);
}

/** Rage or dead events grouped by path + target, most frequent first. */
export function rageDeadRows(
  rows: readonly ClickRow[],
  kind: 'rage' | 'dead',
  ids: readonly string[] = [],
  limit = TARGET_LIMIT,
): RageDeadRowDto[] {
  type Acc = {
    path: string;
    target: string;
    count: number;
    sessions: Set<number>;
    labels: Map<string | null, number>;
    last: number;
    lastSession: number;
  };
  const groups = new Map<string, Acc>();
  for (const row of rows) {
    if (row.kind !== kind) continue;
    const key = `${row.path}\u0000${row.target}`;
    let g = groups.get(key);
    if (!g) {
      g = { path: row.path, target: row.target, count: 0, sessions: new Set(), labels: new Map(), last: 0, lastSession: row.session };
      groups.set(key, g);
    }
    g.count += 1;
    g.sessions.add(row.session);
    g.labels.set(row.label, (g.labels.get(row.label) ?? 0) + 1);
    if (row.ts >= g.last) {
      g.last = row.ts;
      g.lastSession = row.session;
    }
  }
  return [...groups.values()]
    .map((g) => ({
      path: g.path,
      target: g.target,
      label: topLabel(g.labels),
      count: g.count,
      sessions: g.sessions.size,
      lastAt: new Date(g.last).toISOString(),
      lastSessionId: ids[g.lastSession] ?? null,
    }))
    .sort((a, b) => b.count - a.count || (a.lastAt < b.lastAt ? 1 : -1))
    .slice(0, limit);
}

/** Map dots: one per click event, then the rage and dead events as flagged dots on top. */
export function clickPoints(rows: readonly ClickRow[], targets: readonly string[]): ClickPointDto[] {
  const index = new Map(targets.map((t, i) => [t, i]));
  return rows
    .filter((r) => r.kind === 'click')
    .map((r) => ({ x: r.xPct / 100, y: r.y, docH: r.docH, rage: false, dead: false, target: index.get(r.target) ?? -1 }))
    .concat(
      rows
        .filter((r) => r.kind !== 'click')
        .map((r) => ({ x: r.xPct / 100, y: r.y, docH: r.docH, rage: r.kind === 'rage', dead: r.kind === 'dead', target: index.get(r.target) ?? -1 })),
    );
}
