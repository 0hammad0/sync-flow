import 'server-only';

import {
  listCityStats,
  listCountryStats,
  listRegionStats,
  type QueryResult,
} from '@/features/admin/analytics/queries';
import type { BreakdownDto } from '@/features/admin/analytics/types';
import type { ResolvedRange } from '@/features/admin/analytics/range';
import { UNKNOWN_REGION, levelOf, type GeoLevel, type GeoTarget } from './drill';

export type GeographyData = {
  level: GeoLevel;
  /** Country level, always: the map, the country name and the country's own total. */
  countries: QueryResult<BreakdownDto>;
  /** The level the table lists (the same object as `countries` at world level). */
  list: QueryResult<BreakdownDto>;
  /** City level: the country's regions, for the drilled region's own total (empty-state copy). Else null. */
  regions: QueryResult<BreakdownDto> | null;
};

/**
 * One rollup read per range, shared by every level (07-geography.md
 * "Budget"): countries, regions and cities are maps of the same cached
 * `a_daily` / `a_hourly` docs, so drilling down costs no extra reads.
 * The caller has passed requireAdmin('analytics:read').
 */
export async function getGeography(range: ResolvedRange, target: GeoTarget): Promise<GeographyData> {
  const level = levelOf(target);
  const countries = listCountryStats(range);
  const list =
    level === 'country'
      ? countries
      : level === 'region'
        ? listRegionStats(range, target.country!)
        : // The unknown region is no rollup filter: list the country's cities, rows.ts keeps those without one.
          listCityStats(range, target.country!, target.region === UNKNOWN_REGION ? null : target.region);
  const regions = level === 'city' ? listRegionStats(range, target.country!) : null;
  const [c, l, r] = await Promise.all([countries, list, regions]);
  return { level, countries: c, list: l, regions: r };
}
