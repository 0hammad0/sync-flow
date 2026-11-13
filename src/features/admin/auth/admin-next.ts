import { safeNextPath } from '@/shared/lib/safe-next';

export const ADMIN_HOME = '/admin';
export const ADMIN_SIGN_IN = '/admin/sign-in';

/**
 * Where to go after admin sign-in: the `next` param when it is a safe path
 * under `/admin` (query string kept), else `/admin`. Anything else is ignored
 * silently (open-redirect guard, docs 06-states.md 6.6). The sign-in page
 * itself is refused, so a signed-in admin is never bounced back to it.
 */
export function adminNextPath(raw: string | null | undefined): string {
  const next = safeNextPath(raw);
  if (!next) return ADMIN_HOME;
  const path = next.split(/[?#]/, 1)[0];
  if (path !== ADMIN_HOME && !path.startsWith(`${ADMIN_HOME}/`)) return ADMIN_HOME;
  if (path === ADMIN_SIGN_IN || path.startsWith(`${ADMIN_SIGN_IN}/`)) return ADMIN_HOME;
  return next;
}
