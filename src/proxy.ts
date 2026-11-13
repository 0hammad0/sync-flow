import { NextResponse, type NextRequest } from 'next/server';
import { isActionRequest } from '@/server/blocklist/is-action-request';
import {
  blockedActionResponse,
  blockedApiResponse,
  clientCountry,
  clientIp,
  findBlockForRequest,
} from '@/server/blocklist/request';
import { SESSION_COOKIE } from '@/shared/lib/firebase/session';
import { updateSession } from '@/shared/lib/firebase/proxy';
import { safeNextPath } from '@/shared/lib/safe-next';

/** Paths updateSession acts on (redirects only, never a blocklist read). */
function isSessionPath(path: string): boolean {
  return path === '/login' || path === '/dashboard' || path.startsWith('/dashboard/') || path === '/admin' || path.startsWith('/admin/');
}

/**
 * Visitor blocks, action requests only [T-27]. A page view never gets here
 * with a lookup: isActionRequest is two string tests. The blocklist is read
 * lazily (first action on the instance, then at most once per 60 s).
 */
async function blockedResponse(request: NextRequest): Promise<Response | null> {
  const path = request.nextUrl.pathname;
  if (!isActionRequest(request.method, path)) return null;
  const hit = await findBlockForRequest({
    ip: clientIp(request.headers),
    country: clientCountry(request.headers),
    sessionCookie: request.cookies.get(SESSION_COOKIE)?.value ?? null,
  });
  if (!hit) return null;
  return path === '/api' || path.startsWith('/api/') ? blockedApiResponse(hit) : blockedActionResponse(hit);
}

export async function proxy(request: NextRequest) {
  const blocked = await blockedResponse(request);
  if (blocked) return blocked;

  const path = request.nextUrl.pathname;
  // Actions that are not session pages (every /api call, server actions on
  // public pages) need nothing else from the proxy.
  if (!isSessionPath(path)) return NextResponse.next();

  const response = await updateSession(request);

  // updateSession only knows "/login" and "/dashboard"; carry the return path
  // through those redirects so the user lands back where they started.
  const location = response.headers.get('location');
  if (!location) return response;
  const target = new URL(location, request.url);

  if (target.pathname === '/login' && path !== '/login') {
    // Signed-out visit to a protected page → /login?next=<that page>
    target.search = '';
    target.searchParams.set('next', `${path}${request.nextUrl.search}`);
    response.headers.set('location', target.toString());
  } else if (path === '/login' && target.pathname === '/dashboard') {
    // Already signed in → go straight to ?next= instead of /dashboard
    const next = safeNextPath(request.nextUrl.searchParams.get('next'));
    if (next) {
      const dest = new URL(next, request.url);
      if (dest.origin === target.origin) response.headers.set('location', dest.toString());
    }
  }
  return response;
}

/**
 * The proxy runs only where it has work, so a public page view never invokes it:
 * 1. Session pages (redirects only, no blocklist read): /dashboard, /login, /admin.
 * 2. Every /api route, except the never-blocked ones that would only pay for a
 *    pass-through: /api/e (tracker), /api/cleanup and /api/admin/cron (CRON_SECRET).
 *    `DELETE /api/session` is excluded by method inside isActionRequest.
 * 3. Server actions on any page: JS calls carry `next-action`; no-JS form posts
 *    carry a form content type. A GET page view has neither.
 * Measured cost: docs in the phase-1 report ("Proxy cost").
 */
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/login',
    '/admin/:path*',
    '/api/((?!e(?:/|$)|cleanup(?:/|$)|admin/cron(?:/|$)).*)',
    { source: '/:path*', has: [{ type: 'header', key: 'next-action' }] },
    {
      source: '/:path*',
      has: [{ type: 'header', key: 'content-type', value: '(?:multipart/form-data|application/x-www-form-urlencoded).*' }],
    },
  ],
};
