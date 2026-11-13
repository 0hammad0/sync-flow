// Geography drill-down state (07-geography.md "URL state"):
// `?country=PK` → regions of Pakistan, `?country=PK&region=PB` → cities of Punjab.
// Pure and zod-free, so the client table, the map and the server page share it.
import { countryName } from '@/shared/lib/block-values';

export type GeoLevel = 'country' | 'region' | 'city';

/** Where the screen is: no country = world level. `region` only with a country. */
export type GeoTarget = { country: string | null; region: string | null };

/**
 * `?region=` for visits whose country is known but region is not. Vercel
 * region codes are ISO 3166-2 suffixes (letters, digits, `-`), so a leading
 * underscore can never clash with a real one.
 */
export const UNKNOWN_REGION = '_unknown';

const REGION_RE = /^[A-Za-z0-9-]{1,8}$/;

const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

/** ISO 3166-1 alpha-2, upper-cased. `XX` (Vercel's unknown), user-assigned and junk → null (world level). */
export function parseCountryParam(value: unknown): string | null {
  const raw = first(value);
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (code === 'XK') return code; // Kosovo: user-assigned, but Vercel sends it.
  return countryName(code) ? code : null;
}

/** A region code as stored in the rollup keys (case kept), or `UNKNOWN_REGION`. Anything else → null (country level). */
export function parseRegionParam(value: unknown): string | null {
  const raw = first(value);
  if (typeof raw !== 'string') return null;
  const region = raw.trim();
  if (region === UNKNOWN_REGION) return region;
  // Kept as sent: the rollup filter compares it exactly.
  return REGION_RE.test(region) ? region : null;
}

/** Both params; a region without a country is dropped. */
export function parseGeoTarget(search: { country?: unknown; region?: unknown }): GeoTarget {
  const country = parseCountryParam(search.country);
  return { country, region: country ? parseRegionParam(search.region) : null };
}

/** The rows the table lists for a target. */
export function levelOf(target: GeoTarget): GeoLevel {
  if (!target.country) return 'country';
  return target.region ? 'city' : 'region';
}

/** One level up: city → region → country. Null at world level. */
export function parentOf(target: GeoTarget): GeoTarget | null {
  if (!target.country) return null;
  if (target.region) return { country: target.country, region: null };
  return { country: null, region: null };
}

/** Display name of a country code: `Pakistan`, or the code when Intl does not know it (`XK`). */
export function placeCountryName(code: string): string {
  return countryName(code) ?? code;
}

/** Display text of a region param. */
export function regionLabel(region: string): string {
  return region === UNKNOWN_REGION ? 'Unknown region' : region;
}

export type Crumb = { label: string; target: GeoTarget; current: boolean };

/** `All countries › Pakistan › PB`. The last part is the current level. */
export function crumbsFor(target: GeoTarget): Crumb[] {
  const crumbs: Crumb[] = [{ label: 'All countries', target: { country: null, region: null }, current: !target.country }];
  if (target.country) {
    crumbs.push({
      label: placeCountryName(target.country),
      target: { country: target.country, region: null },
      current: !target.region,
    });
  }
  if (target.country && target.region) {
    crumbs.push({ label: regionLabel(target.region), target, current: true });
  }
  return crumbs;
}

/**
 * Params the drill keeps from the current URL: range, view and table look.
 * The page cursor is dropped (every level starts on its first page); the
 * sort is kept, the columns are the same at every level.
 */
const DROPPED = ['country', 'region', 'cursor'];

/** Link to another level, keeping the range and view. Param order is stable for caching and tests. */
export function geoHref(current: URLSearchParams | string | null | undefined, target: GeoTarget, pathname = '/admin/geography'): string {
  const params = new URLSearchParams(current ?? undefined);
  for (const key of DROPPED) params.delete(key);
  if (target.country) params.set('country', target.country);
  if (target.country && target.region) params.set('region', target.region);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
