import { ROUTE_PATTERNS, type RoutePattern } from '../routes';

/**
 * Browser twin of `normalisePath` (../normalise-path.ts), cut down for the
 * tracker chunk's 2 KB budget: it takes `location.pathname` (no query string
 * or hash to strip), masks the three dynamic segments, and keeps only known
 * public pages. So a room code or share/send token never leaves the browser,
 * and `/admin/**` or an unknown page is never sent at all. The server still
 * normalises and validates everything it receives.
 *
 * tests/unit/tracking/page-path.test.ts checks it gives the same answer as
 * `normalisePath` for every route pattern.
 */
const DYNAMIC = /^\/(chat|share|send)\/[^/]+$/;

export function pagePath(pathname: string): RoutePattern | null {
  const path = pathname.replace(DYNAMIC, (_, base: string) => `/${base}/${base === 'chat' ? '[code]' : '[token]'}`);
  return (ROUTE_PATTERNS as readonly string[]).includes(path) ? (path as RoutePattern) : null;
}
