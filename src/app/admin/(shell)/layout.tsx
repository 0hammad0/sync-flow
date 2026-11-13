import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import Forbidden from '@/features/admin/auth/Forbidden';
import AdminShell from '@/features/admin/shell/AdminShell';
import LazyToaster from '@/features/admin/shell/LazyToaster';
import SignInRedirect from '@/features/admin/shell/SignInRedirect';
import { noticeFor } from '@/features/admin/shell/account';
import { SIDEBAR_COOKIE, parseSidebarCookie } from '@/features/admin/shell/sidebar-state';
import { requireAdmin } from '@/server/auth/require-admin';
import { recordSignInOnce } from '@/server/auth/sign-in-audit';
import type { AdminContext } from '@/server/auth/types';
import { ForbiddenError, UnauthorizedError } from '@/server/errors';
import { TooltipProvider } from '@/shared/ui/Tooltip';

// Entry permission: any admin role (01-auth.md "Permission": analytics:read minimum).
// authInterrupts stays off, so no-role users get <Forbidden /> rendered here.
export default async function AdminShellLayout({ children }: { children: ReactNode }) {
  let ctx: AdminContext;
  try {
    ctx = await requireAdmin('analytics:read');
  } catch (e) {
    // The path is only known to a client leaf; it redirects during SSR.
    if (e instanceof UnauthorizedError) return <SignInRedirect notice={noticeFor(e.reason)} />;
    if (e instanceof ForbiddenError) return <Forbidden email={e.detail?.email ?? null} />;
    throw e;
  }
  recordSignInOnce(ctx);

  const sidebarMode = parseSidebarCookie((await cookies()).get(SIDEBAR_COOKIE)?.value);

  return (
    <TooltipProvider>
      <AdminShell ctx={ctx} sidebarMode={sidebarMode}>
        {children}
      </AdminShell>
      <LazyToaster />
    </TooltipProvider>
  );
}
