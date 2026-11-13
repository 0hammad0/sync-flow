import { z } from 'zod';
import { parseRangeParams } from '@/features/admin/analytics/range-schema';
import type { RangeParams } from '@/features/admin/analytics/range';
import type { ExportTable } from './tables';

// Export params: the same keys as each screen's URL state (04/05/07/08
// feature specs), zod-checked. Like the screens, an unusable value falls back
// silently (bad `?tab=` → referrers). Keys not listed here are ignored, so
// nothing in the URL can widen the query or pick fields.

type Search = Record<string, string | string[] | undefined>;

const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
const text = (max: number) =>
  z.preprocess(first, z.string().trim().max(max).transform((s) => s || null)).nullable().catch(null);
const oneOf = <T extends string>(values: readonly [T, ...T[]], fallback: T) =>
  z.preprocess(first, z.enum(values)).catch(fallback);
const optionalOneOf = <T extends string>(values: readonly [T, ...T[]]) =>
  z.preprocess(first, z.enum(values)).nullable().catch(null);
const pattern = (re: RegExp, map: (s: string) => string = (s) => s) =>
  z.preprocess(first, z.string().trim().transform(map).pipe(z.string().regex(re))).nullable().catch(null);

/** `sort=-field` or `sort=field` on an allowlisted field; anything else → the table's default order. */
function sortParam<T extends string>(fields: readonly [T, ...T[]], aliases: Readonly<Record<string, T>> = {}) {
  return z
    .preprocess(first, z.string().trim().regex(/^-?[A-Za-z_]+$/))
    .transform((s) => {
      const id = s.replace(/^-/, '');
      return { field: aliases[id] ?? id, desc: s.startsWith('-') };
    })
    .pipe(z.object({ field: z.enum(fields), desc: z.boolean() }))
    .nullable()
    .catch(null);
}

export const DEVICES = ['desktop', 'mobile', 'tablet'] as const;
const COUNTRY = /^[A-Z]{2}$/;

/** Sessions (04-sessions.md): `?q&country&device`, one filter at a time (`q` first). */
export const sessionsExportSchema = z.object({
  q: text(100),
  country: pattern(COUNTRY, (s) => s.toUpperCase()),
  device: optionalOneOf(DEVICES),
});

export const PAGE_SORT_FIELDS = [
  'path',
  'pageviews',
  'visitors',
  'sessions',
  'entries',
  'exits',
  'avgEngagedMs',
  'bounceRate',
  'exitRate',
  'avgScroll',
] as const;

/** Pages (05-pages.md): `?q&mode&sort`. */
export const pagesExportSchema = z.object({
  q: text(200),
  mode: oneOf(['all', 'entry', 'exit'], 'all'),
  sort: sortParam(PAGE_SORT_FIELDS),
});

export const BREAKDOWN_SORT_FIELDS = ['label', 'visitors', 'sessions', 'pageviews', 'avgEngagedMs', 'bounceRate', 'share'] as const;

/** Geography (07-geography.md): `?country&region&sort`. Bad country → world level. */
export const countriesExportSchema = z.object({
  country: pattern(COUNTRY, (s) => s.toUpperCase()),
  // `_unknown` = the cities with no region (geography/drill.ts UNKNOWN_REGION).
  region: pattern(/^(?:_unknown|[A-Za-z0-9-]{1,10})$/),
  // The Geography table's own column ids (geography/rows.ts GEO_SORT).
  sort: sortParam(BREAKDOWN_SORT_FIELDS, { place: 'label', avg_time: 'avgEngagedMs', bounce: 'bounceRate' }),
});

export const SOURCE_TABS = ['referrers', 'utm', 'devices', 'browsers', 'os'] as const;
export const UTM_KINDS = ['source', 'medium', 'campaign'] as const;

/** Sources (08-sources.md): `?tab&utm&sort`. */
export const sourcesExportSchema = z.object({
  tab: oneOf(SOURCE_TABS, 'referrers'),
  utm: oneOf(UTM_KINDS, 'source'),
  sort: sortParam(BREAKDOWN_SORT_FIELDS),
});

export type SessionsExportParams = z.infer<typeof sessionsExportSchema>;
export type PagesExportParams = z.infer<typeof pagesExportSchema>;
export type CountriesExportParams = z.infer<typeof countriesExportSchema>;
export type SourcesExportParams = z.infer<typeof sourcesExportSchema>;
export type ExportSort = { field: string; desc: boolean } | null;

export type ExportRequest =
  | { table: 'sessions'; range: RangeParams; params: SessionsExportParams }
  | { table: 'pages'; range: RangeParams; params: PagesExportParams }
  | { table: 'countries'; range: RangeParams; params: CountriesExportParams }
  | { table: 'sources'; range: RangeParams; params: SourcesExportParams };

/** URL search → a checked export request. Never throws. */
export function parseExportRequest(table: ExportTable, search: Search): ExportRequest {
  const range = parseRangeParams(search);
  // Every key made present first: zod 4 skips the transform of a missing key.
  const all = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, search[k] ?? null]));
  switch (table) {
    case 'sessions':
      return { table, range, params: sessionsExportSchema.parse(all(['q', 'country', 'device'])) };
    case 'pages':
      return { table, range, params: pagesExportSchema.parse(all(['q', 'mode', 'sort'])) };
    case 'countries':
      return { table, range, params: countriesExportSchema.parse(all(['country', 'region', 'sort'])) };
    case 'sources':
      return { table, range, params: sourcesExportSchema.parse(all(['tab', 'utm', 'sort'])) };
  }
}

/** URLSearchParams → the record shape the schemas read (repeated keys kept as arrays). */
export function searchRecord(params: URLSearchParams): Search {
  const out: Search = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    out[key] = values.length > 1 ? values : values[0];
  }
  return out;
}
