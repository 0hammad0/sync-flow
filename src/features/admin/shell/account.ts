import type { AdminRole } from '@/server/auth/types';

export const ADMIN_SIGN_IN = '/admin/sign-in';

const ROLE_LABELS: Record<AdminRole, string> = {
  owner: 'Owner',
  moderator: 'Moderator',
  viewer: 'Viewer',
};

export function roleLabel(role: AdminRole): string {
  return ROLE_LABELS[role];
}

/**
 * Avatar initials (05-components.md "Avatar"): first letter before the `@`,
 * plus the first letter after a `.` or `_` if any. "hammad.k@…" → "HK".
 */
export function initialsFor(email: string | null): string {
  const local = email?.split('@')[0]?.trim() ?? '';
  if (!local) return '?';
  const parts = local.split(/[._]/).filter(Boolean);
  const first = parts[0]?.[0] ?? local[0];
  const second = parts.length > 1 ? parts[1][0] : '';
  return `${first}${second}`.toUpperCase();
}

/** Messages the sign-in page shows from `?notice=`. */
export type SignInNotice = 'disabled' | 'everywhere';

/**
 * Sign-in URL that returns to `path` (+ query). Only admin paths are kept as
 * `next`; the sign-in page validates it again.
 */
export function signInHref(path: string, search = '', notice?: SignInNotice): string {
  const params = new URLSearchParams();
  if (notice) params.set('notice', notice);
  const isAdminPath = path === '/admin' || path.startsWith('/admin/');
  const isSignIn = path === ADMIN_SIGN_IN || path.startsWith(`${ADMIN_SIGN_IN}/`);
  if (isAdminPath && !isSignIn) {
    const query = search && search !== '?' ? (search.startsWith('?') ? search : `?${search}`) : '';
    params.set('next', `${path}${query}`);
  }
  const qs = params.toString();
  return qs ? `${ADMIN_SIGN_IN}?${qs}` : ADMIN_SIGN_IN;
}

/** `disabled` gets its own sign-in message; every other 401 is a plain sign-in. */
export function noticeFor(reason: string): SignInNotice | undefined {
  return reason === 'disabled' ? 'disabled' : undefined;
}
