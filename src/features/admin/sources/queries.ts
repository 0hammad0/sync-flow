import 'server-only';

import {
  getBrowserVersions,
  getReferrerEntryPages,
  listSourceStats,
  type QueryResult,
} from '@/features/admin/analytics/queries';
import type { ResolvedRange } from '@/features/admin/analytics/range';
import type { BreakdownRow, RangeMeta, SampleBreakdownDto } from '@/features/admin/analytics/types';
import { dimFor, type SourceDimKey, type SourceTab, type UtmField } from './constants';
import { hostFromParam, selectSourceRows, type SourceSelection } from './rows';

// Sources queries (08-sources.md "Data"). The caller has passed
// requireAdmin('analytics:read'). Every tab reads the cached rollup docs
// (shared with Overview); only the drills read the ≤ 500-session sample.

export type SourceListDto = SourceSelection & {
  dim: SourceDimKey;
  /** Every row of the map (donut, "no tags" check), not just this page. */
  all: BreakdownRow[];
  meta: RangeMeta;
};

export async function listSources(
  range: ResolvedRange,
  input: { tab: SourceTab; utm: UtmField; sort: string; cursor: number },
): Promise<QueryResult<SourceListDto>> {
  const dim = dimFor(input.tab, input.utm);
  const result = await listSourceStats(range, dim);
  if (result.state !== 'ok') return result;
  const { rows, meta } = result.data;
  return { state: 'ok', data: { ...selectSourceRows(input.tab, rows, input), dim, all: rows, meta } };
}

/** Referrer → top entry pages, or browser → versions, from the newest 500 sessions (≤ 30 days, cached 30 min). */
export function getSourceDrill(range: ResolvedRange, tab: SourceTab, drill: string): Promise<QueryResult<SampleBreakdownDto>> {
  return tab === 'browsers' ? getBrowserVersions(range, drill) : getReferrerEntryPages(range, hostFromParam(drill));
}
