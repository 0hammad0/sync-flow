// What counts as an action [T-27]. Pure and dependency-free: the proxy runs
// it on every request it sees, so it must stay a couple of string tests.
// Spec: docs/admin/03-features/10-access-control.md ("Enforcement").
//
// No 'server-only' here: the proxy bundle imports it, and it holds no secret.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Never blocked, even though they are actions:
 * - `CRON_SECRET` routes (`/api/cleanup`, `/api/admin/cron/**`): Vercel cron, not a visitor
 * - `DELETE /api/session`: sign-out must always work
 * - `/api/e`: the tracker drops a blocked visitor's events itself and answers 204
 */
export function isBlockExempt(method: string, pathname: string): boolean {
  if (under(pathname, '/api/cleanup') || under(pathname, '/api/admin/cron')) return true;
  if (under(pathname, '/api/e')) return true;
  return method.toUpperCase() === 'DELETE' && pathname === '/api/session';
}

/**
 * True when the request is an action a block stops:
 * - any `/api/**` call, any method (every route handler), or
 * - any method other than GET / HEAD / OPTIONS (server actions post to the
 *   page URL; JS calls carry `next-action`, no-JS form posts do not, so the
 *   method test is the safe one).
 * Page views are GET (or HEAD), so they are never actions.
 */
export function isActionRequest(method: string, pathname: string): boolean {
  if (isBlockExempt(method, pathname)) return false;
  if (under(pathname, '/api')) return true;
  return !SAFE_METHODS.has(method.toUpperCase());
}
