import 'server-only';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/server/auth/require-admin';
import type { Permission } from '@/server/auth/permissions';
import type { AdminContext } from '@/server/auth/types';
import { UnauthorizedError } from '@/server/errors';
import { noticeFor, signInHref } from './account';

/**
 * requireAdmin for a page. The (shell) layout checks too, but layouts do not
 * re-render on client navigation, so every page checks for itself. Same
 * request = same verify (requireAdmin is cache()-wrapped).
 *
 * No session → redirect to sign-in with `next=path`. ForbiddenError is
 * rethrown: the layout already shows the no-role screen, and a page that
 * needs more than `analytics:read` renders its own in-shell 403.
 */
export async function requireAdminPage(permission: Permission, path: string): Promise<AdminContext> {
  try {
    return await requireAdmin(permission);
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect(signInHref(path, '', noticeFor(e.reason)));
    throw e;
  }
}
