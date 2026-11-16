import { signOut } from 'firebase/auth';
import { clientAuth } from '@/shared/lib/firebase/client';
import { clearAuthHint } from '@/shared/lib/auth-state';

// Sign-out for the account menu and the command palette (01-auth.md).

export type SignOutResult = { ok: true } | { ok: false; message: string };

/** Persistent error toast. sonner loads lazily (LazyToaster), so import it on use. */
export async function toastError(title: string, description: string) {
  const { toast } = await import('sonner');
  toast.error(title, { description, duration: Infinity });
}

/**
 * Ends this browser's admin session (`DELETE /api/session`), or every session
 * with `?everywhere=1`. Also signs the Firebase client out, like the public
 * header does, so the site and the sign-in page see a signed-out user.
 */
export async function endSession(everywhere: boolean): Promise<SignOutResult> {
  let response: Response;
  try {
    response = await fetch(everywhere ? '/api/session?everywhere=1' : '/api/session', { method: 'DELETE' });
  } catch {
    return { ok: false, message: 'The connection dropped. You are still signed in.' };
  }
  if (!response.ok) {
    return {
      ok: false,
      message: everywhere
        ? "Other devices couldn't be signed out. You are still signed in."
        : 'The server hit an error. You are still signed in.',
    };
  }
  try {
    await signOut(clientAuth());
  } catch {
    // The session cookie is gone, which is what protects /admin.
  }
  clearAuthHint();
  return { ok: true };
}
