import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/shared/lib/firebase/admin';
import { mintSessionCookie, SESSION_COOKIE } from '@/shared/lib/firebase/session';

export const runtime = 'nodejs';

// POST — exchange a fresh Firebase ID token for an httpOnly session cookie.
export async function POST(request: NextRequest) {
  // Login CSRF guard: a cross-site <form> could otherwise post an attacker's
  // token (text/plain bodies still parse as JSON) and sign the victim into
  // the attacker's account. Only our own pages, sending real JSON, may call this.
  const origin = request.headers.get('origin');
  const contentType = request.headers.get('content-type') ?? '';
  if (origin !== request.nextUrl.origin || !contentType.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { idToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const idToken = body.idToken;
  if (!idToken) {
    return NextResponse.json({ error: 'Missing idToken' }, { status: 400 });
  }

  // Verify the ID token is fresh (< 5 min old) — Firebase requirement for createSessionCookie
  try {
    const decoded = await adminAuth().verifyIdToken(idToken, true);
    const ageSec = Date.now() / 1000 - decoded.auth_time;
    if (ageSec > 5 * 60) {
      return NextResponse.json({ error: 'ID token too old; sign in again' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid ID token' }, { status: 401 });
  }

  const cookie = await mintSessionCookie(idToken);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookie);
  return res;
}

// DELETE — sign out on this device: clear this browser's cookie only. Other
// devices stay signed in.
//
// `?everywhere=1` (admin "Sign out everywhere") first revokes the user's
// refresh tokens, which ends every session: each other device fails
// verifySessionCookie(c, true) on its next admin request. If the revoke
// fails, this device is still signed out but the answer is 500
// `revoke_failed`, so the UI never claims other devices were signed out.
// A cookie that is already invalid has no user to revoke: plain sign-out.
export async function DELETE(request: NextRequest) {
  const cookieValue = request.cookies.get(SESSION_COOKIE)?.value;
  let revokeFailed = false;
  if (cookieValue && request.nextUrl.searchParams.get('everywhere') === '1') {
    revokeFailed = !(await revokeAllSessions(cookieValue));
  }

  const res = revokeFailed
    ? NextResponse.json({ ok: false, error: 'revoke_failed' }, { status: 500 })
    : NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    maxAge: 0,
    path: '/',
  });
  return res;
}

/** True when revoked, or when the cookie is unusable (nothing to revoke). False on a server failure. */
async function revokeAllSessions(cookieValue: string): Promise<boolean> {
  let uid: string;
  try {
    uid = (await adminAuth().verifySessionCookie(cookieValue)).uid;
  } catch (e) {
    if (isFirebaseAuthError(e)) return true;
    console.error('[session] sign out everywhere: could not verify the cookie', e);
    return false;
  }
  try {
    await adminAuth().revokeRefreshTokens(uid);
    return true;
  } catch (e) {
    // A deleted user has no sessions left to end.
    if ((e as { code?: unknown } | null)?.code === 'auth/user-not-found') return true;
    console.error('[session] sign out everywhere: revokeRefreshTokens failed', e);
    return false;
  }
}

function isFirebaseAuthError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('auth/');
}
