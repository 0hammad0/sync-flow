import 'server-only';

import { getClickPaths, getClickSample, type QueryResult } from '@/features/admin/analytics/queries';
import type { ResolvedRange } from '@/features/admin/analytics/range';
import type { RangeMeta } from '@/features/admin/analytics/types';
import { mapAllowed } from './constants';
import { clickPoints, rageDeadRows, rankTargets, selectClicks, type RankSort } from './rows';
import type { ClickPointDto, ClickSampleMeta, ClickTargetDto, RageDeadRowDto, TrackedPathDto, VwBucket } from './types';

// Clicks queries (06-clicks.md "Data"). The caller has passed
// requireAdmin('analytics:read'). Two sources, both cached and shared:
// - path options and per-path totals: the same rollup docs as Overview and
//   Pages (`clicks.{p}` and `path.{p}`), no extra reads;
// - targets, dots, rage and dead lists: ONE cached sample of the newest 500
//   sessions in range (≤ 500 reads per 30 min per range), filtered in memory.

export type ClickQuery = { path: string | null; vw: VwBucket };

async function sampled<T>(
  range: ResolvedRange,
  query: ClickQuery,
  build: (rows: ReturnType<typeof selectClicks>, pageviews: number, ids: readonly string[]) => T,
): Promise<QueryResult<{ data: T; meta: ClickSampleMeta }>> {
  const result = await getClickSample(range);
  if (result.state !== 'ok') return result;
  const { sample, from, to } = result.data;
  const rows = selectClicks(sample, { path: query.path, vw: query.vw });
  const pageviews = query.path ? (sample.pageviews[query.path] ?? 0) : Object.values(sample.pageviews).reduce((a, b) => a + b, 0);
  return {
    state: 'ok',
    data: {
      data: build(rows, pageviews, sample.ids),
      meta: { sampleSessions: sample.sessions, sampleClicks: rows.filter((r) => r.kind === 'click').length, truncated: sample.truncated, from, to },
    },
  };
}

/** Path picker: every tracked path in range with views, click totals and whether it can be framed. */
export async function listTrackedPaths(range: ResolvedRange): Promise<QueryResult<{ rows: TrackedPathDto[]; meta: RangeMeta }>> {
  const result = await getClickPaths(range);
  if (result.state !== 'ok') return result;
  return {
    state: 'ok',
    data: { rows: result.data.rows.map((r) => ({ ...r, mapAllowed: mapAllowed(r.path) })), meta: result.data.meta },
  };
}

/** Element ranking for one path and viewport. */
export function listClickTargets(range: ResolvedRange, query: ClickQuery & { sort?: RankSort }) {
  return sampled<ClickTargetDto[]>(range, query, (rows, pageviews) => rankTargets(rows, pageviews, query.sort ?? 'clicks'));
}

/** Map dots and the targets they point at. */
export function listClickPoints(range: ResolvedRange, query: ClickQuery) {
  return sampled<{ points: ClickPointDto[]; targets: ClickTargetDto[] }>(range, query, (rows, pageviews) => {
    const targets = rankTargets(rows, pageviews);
    return { points: clickPoints(rows, targets.map((t) => t.target)), targets };
  });
}

/** Rage clicks grouped by path + target (`path: null` = every path). */
export function listRageClicks(range: ResolvedRange, query: ClickQuery) {
  return sampled<RageDeadRowDto[]>(range, query, (rows, _views, ids) => rageDeadRows(rows, 'rage', ids));
}

/** Dead clicks grouped by path + target (`path: null` = every path). */
export function listDeadClicks(range: ResolvedRange, query: ClickQuery) {
  return sampled<RageDeadRowDto[]>(range, query, (rows, _views, ids) => rageDeadRows(rows, 'dead', ids));
}
