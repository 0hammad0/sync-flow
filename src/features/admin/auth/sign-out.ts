'use client';

import { signOut } from 'firebase/auth';
import { clearAuthHint } from '@/shared/lib/auth-state';
import { clientAuth } from '@/shared/lib/firebase/client';
import { ADMIN_SIGN_IN } from './admin-next';

export type SignOutResult = { ok: true } | { ok: false; error: string };

/**
 * Admin sign-out. `DELETE /api/session` clears the cookie; `everywhere` also
 * revokes every session of this user. Then the Firebase client is signed out
 * (same steps as the public header) and the browser loads the sign-in page
 * fresh, which drops all signed-in client state.
 *
 * Returns an error (and stays on the page) when the cookie could not be
 * cleared, or when "everywhere" could not end the other sessions.
 */
export async function signOutAdmin({ everywhere = false }: { everywhere?: boolean } = {}): Promise<SignOutResult> {
  let res: Response;
  try {
    res = await fetch(everywhere ? '/api/session?everywhere=1' : '/api/session', { method: 'DELETE' });
  } catch {
    return { ok: false, error: 'Couldn’t sign out. Check your connection and try again.' };
  }
  // On a failed revoke the server still cleared this device's cookie.
  const clearedHere = res.ok || (everywhere && res.status === 500);
  if (!clearedHere) return { ok: false, error: 'Couldn’t sign out. Try again.' };

  await signOut(clientAuth()).catch(() => {});
  clearAuthHint();

  if (!res.ok) {
    return { ok: false, error: 'Signed out here, but couldn’t sign out your other devices. Sign in and try again.' };
  }
  window.location.replace(everywhere ? `${ADMIN_SIGN_IN}?notice=everywhere` : ADMIN_SIGN_IN);
  return { ok: true };
}
