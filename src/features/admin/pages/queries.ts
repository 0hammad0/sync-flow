import 'server-only';

import {
  getPageFlow,
  getPageStats,
  getPageTrend,
  type QueryResult,
} from '@/features/admin/analytics/queries';
import type { ResolvedRange } from '@/features/admin/analytics/range';
import type { PageFlowDto, PageTrendDto, RangeMeta } from '@/features/admin/analytics/types';
import { selectPageRows, type PageQuery, type PageSelection } from './rows';

// Pages queries (05-pages.md "Data"). The caller has passed
// requireAdmin('analytics:read'). Reads go through the shared, cached
// analytics data layer: the table costs the same rollup docs as Overview.

export type PageListDto = PageSelection & { meta: RangeMeta };

/** One table page: every path from the cached rollups, then search, mode, sort and paging in memory. */
export async function listPageStats(range: ResolvedRange, query: PageQuery): Promise<QueryResult<PageListDto>> {
  const result = await getPageStats(range);
  if (result.state !== 'ok') return result;
  return { state: 'ok', data: { ...selectPageRows(result.data.rows, query), meta: result.data.meta } };
}

export type PageDetail = { trend: QueryResult<PageTrendDto>; flow: QueryResult<PageFlowDto> };

/** Trend (same rollup docs as the table) and flow (≤ 500 sessions, cached 30 min) for one known path. Each fails on its own. */
export async function getPageDetail(range: ResolvedRange, path: string): Promise<PageDetail> {
  const [trend, flow] = await Promise.all([getPageTrend(range, path), getPageFlow(range, path)]);
  return { trend, flow };
}
