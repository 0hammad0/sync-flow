import type { ReactNode } from 'react';
import { cookies, headers } from 'next/headers';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import Forbidden from '@/features/admin/auth/Forbidden';
import AdminShell from '@/features/admin/shell/AdminShell';
import LazyToaster from '@/features/admin/shell/LazyToaster';
import SignInRedirect from '@/features/admin/shell/SignInRedirect';
import QuotaBanner from '@/features/admin/health/components/QuotaBanner';
import { getQuotaUsage } from '@/features/admin/health/queries';
import { quotaBanner } from '@/features/admin/health/tracking-status';
import { noticeFor } from '@/features/admin/shell/account';
import { SIDEBAR_COOKIE, parseSidebarCookie } from '@/features/admin/shell/sidebar-state';
import { can } from '@/server/auth/permissions';
import { requireAdmin } from '@/server/auth/require-admin';
import { recordSignInOnce } from '@/server/auth/sign-in-audit';
import { clientCountry, clientIp } from '@/server/blocklist/request';
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
  // Amber/red Firestore budget strip on every admin page (14-health.md). From
  // QuotaGuard's in-memory copy: at most 1–2 reads a minute per instance.
  const banner = await getQuotaUsage()
    .then(quotaBanner)
    .catch(() => null);
  // The palette's Block dialog warns before an admin blocks themselves; it needs
  // their own IP and country, like the access screen. Only for roles that can block.
  const h = can(ctx.role, 'blocks:write') ? await headers() : null;
  const blockActor = h ? { uid: ctx.uid, ip: clientIp(h), country: clientCountry(h) } : null;

  return (
    // NuqsAdapter: URL state for the DataTable kit (sort, cursor, filters).
    <NuqsAdapter>
      <TooltipProvider>
        <AdminShell
          ctx={ctx}
          sidebarMode={sidebarMode}
          blockActor={blockActor}
          notice={banner && <QuotaBanner banner={banner} variant="bar" />}>
          {children}
        </AdminShell>
        <LazyToaster />
      </TooltipProvider>
    </NuqsAdapter>
  );
}
