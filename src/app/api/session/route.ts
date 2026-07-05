import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/shared/lib/firebase/admin';
import { mintSessionCookie, SESSION_COOKIE } from '@/shared/lib/firebase/session';

export const runtime = 'nodejs';

// POST — exchange a fresh Firebase ID token for an httpOnly session cookie.
export async function POST(request: NextRequest) {
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

// DELETE — sign out: revoke refresh tokens, clear cookie.
export async function DELETE(request: NextRequest) {
  const cookieValue = request.cookies.get(SESSION_COOKIE)?.value;
  if (cookieValue) {
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
