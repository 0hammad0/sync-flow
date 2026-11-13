import { NextResponse, type NextRequest } from 'next/server';
import { adminAuth } from './admin';
import { SESSION_COOKIE } from './session';
import { safeNextPath } from '../safe-next';

export const ADMIN_SIGN_IN_PATH = '/admin/sign-in';

/**
 * `/admin` and everything under it, except the sign-in page. `/api/admin/**`
 * never matches: routes answer JSON 401/403 from requireAdmin, not a redirect.
 */
export function isProtectedAdminPath(path: string): boolean {
  if (path !== '/admin' && !path.startsWith('/admin/')) return false;
  return path !== ADMIN_SIGN_IN_PATH && !path.startsWith(`${ADMIN_SIGN_IN_PATH}/`);
}

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isDashboard = path.startsWith('/dashboard');
  const isLogin = path === '/login';
  const isAdmin = isProtectedAdminPath(path);

  // Nothing below acts on other paths, so skip the cookie verify for them.
  if (!isDashboard && !isLogin && !isAdmin) return NextResponse.next();

  const cookie = request.cookies.get(SESSION_COOKIE)?.value;

  let signedIn = false;
  if (cookie) {
    try {
      // checkRevoked=false: fast local JWT verify on every request.
      // Sensitive operations should re-verify with checkRevoked=true.
      await adminAuth().verifySessionCookie(cookie, false);
      signedIn = true;
    } catch {
      // Invalid/expired — fall through
    }
  }

  if (isAdmin && !signedIn) {
    // Redirect only. Roles are checked by requireAdmin in the page (T-6).
    const url = request.nextUrl.clone();
    url.pathname = ADMIN_SIGN_IN_PATH;
    url.search = '';
    const next = safeNextPath(`${path}${request.nextUrl.search}`);
    if (next) url.searchParams.set('next', next);
    const res = NextResponse.redirect(url);
    if (cookie) res.cookies.set({ name: SESSION_COOKIE, value: '', maxAge: 0, path: '/' });
    return res;
  }

  if (isDashboard && !signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    const res = NextResponse.redirect(url);
    if (cookie && !signedIn) {
      // Clean up dead cookie
      res.cookies.set({ name: SESSION_COOKIE, value: '', maxAge: 0, path: '/' });
    }
    return res;
  }

  if (isLogin && signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
