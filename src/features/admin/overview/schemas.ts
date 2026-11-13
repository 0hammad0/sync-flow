import { parseRangeParams, rangeParamsSchema } from '@/features/admin/analytics/range-schema';
import type { RangeParams } from '@/features/admin/analytics/range';

// Overview URL state (02-overview.md "Range handling"). Overview reads only the
// shared `?range=` / `?from=` / `?to=`. The schema never fails: anything
// unusable falls back to 7d in resolveAnalyticsRange, with no error shown.

export const rangeSchema = rangeParamsSchema;

export type OverviewSearchParams = Record<string, string | string[] | undefined>;

export function parseOverviewParams(search: OverviewSearchParams | null | undefined): RangeParams {
  return parseRangeParams(search);
}
