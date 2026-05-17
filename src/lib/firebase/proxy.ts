import { NextResponse, type NextRequest } from 'next/server';
import { adminAuth } from './admin';
import { SESSION_COOKIE } from './session';

export async function updateSession(request: NextRequest) {
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

  const path = request.nextUrl.pathname;

  if (path.startsWith('/dashboard') && !signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    const res = NextResponse.redirect(url);
    if (cookie && !signedIn) {
      // Clean up dead cookie
      res.cookies.set({ name: SESSION_COOKIE, value: '', maxAge: 0, path: '/' });
    }
    return res;
  }

  if (path === '/login' && signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
