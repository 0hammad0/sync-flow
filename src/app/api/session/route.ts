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
// devices stay signed in. `?everywhere=1` also revokes the user's refresh
// tokens, which ends every session (no UI uses it yet).
export async function DELETE(request: NextRequest) {
  const cookieValue = request.cookies.get(SESSION_COOKIE)?.value;
  if (cookieValue && request.nextUrl.searchParams.get('everywhere') === '1') {
    try {
      const decoded = await adminAuth().verifySessionCookie(cookieValue);
      await adminAuth().revokeRefreshTokens(decoded.uid);
    } catch {
      // Cookie invalid/expired — still clear it below
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    maxAge: 0,
    path: '/',
  });
  return res;
}
