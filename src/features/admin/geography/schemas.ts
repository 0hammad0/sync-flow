import { z } from 'zod';
import { parseGeoTarget, type GeoTarget } from './drill';
import { GEO_SORT } from './rows';

// Server-side reading of the Geography URL (07-geography.md "URL state"):
// `?range&from&to` (range-schema.ts) plus `country`, `region`, `sort`,
// `cursor`. `view` is client-only (the map panel). Never fails: a bad
// `country` falls back to world level, a bad `region` to the country,
// a bad `sort` to `-visitors`.

const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

const SORT_VALUES = new Set([...GEO_SORT.allowed, ...GEO_SORT.allowed.map((id) => `-${id}`)]);

export type GeoParams = GeoTarget & { sort: string; cursor: string | null };

export const geoParamsSchema = z
  .preprocess(
    (input) => {
      const s = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
      return { country: s.country ?? null, region: s.region ?? null, sort: s.sort ?? null, cursor: s.cursor ?? null };
    },
    z.object({ country: z.unknown(), region: z.unknown(), sort: z.unknown(), cursor: z.unknown() }),
  )
  .transform((raw): GeoParams => {
    const sort = first(raw.sort);
    const cursor = first(raw.cursor);
    return {
      ...parseGeoTarget(raw),
      sort: typeof sort === 'string' && SORT_VALUES.has(sort) ? sort : GEO_SORT.default,
      cursor: typeof cursor === 'string' && cursor ? cursor : null,
    };
  })
  .catch({ country: null, region: null, sort: GEO_SORT.default, cursor: null });

/** Next.js `searchParams` → GeoParams. */
export function parseGeoParams(search: Record<string, string | string[] | undefined> | null | undefined): GeoParams {
  return geoParamsSchema.parse(search);
}
