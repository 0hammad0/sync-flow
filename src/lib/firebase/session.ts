import { cookies } from 'next/headers';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from './admin';

export const SESSION_COOKIE = '__session';
export const SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // Firebase max

export type SessionCookieOptions = {
  name: string;
  value: string;
  maxAge: number;
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
};

export async function mintSessionCookie(idToken: string): Promise<SessionCookieOptions> {
  const value = await adminAuth().createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });
  return {
    name: SESSION_COOKIE,
    value,
    maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
}

export async function currentUser(): Promise<DecodedIdToken | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    return await adminAuth().verifySessionCookie(cookie, true);
  } catch {
    return null;
  }
}
