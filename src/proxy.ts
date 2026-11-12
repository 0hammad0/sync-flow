import { type NextRequest } from 'next/server';
import { updateSession } from '@/shared/lib/firebase/proxy';
import { safeNextPath } from '@/shared/lib/safe-next';

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);

  // updateSession only knows "/login" and "/dashboard"; carry the return path
  // through those redirects so the user lands back where they started.
  const location = response.headers.get('location');
  if (!location) return response;
  const target = new URL(location, request.url);
  const path = request.nextUrl.pathname;

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

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
