import type { ReactNode } from 'react';
import Logo from '@/shared/components/Logo';
import OfflineBanner from '@/shared/ui/OfflineBanner';
import { can } from '@/server/auth/permissions';
import type { AdminContext } from '@/server/auth/types';
import AccountMenu from './AccountMenu';
import PinToggle from './PinToggle';
import ShellFrame from './ShellFrame';
import Sidebar from './Sidebar';
import SidebarNav from './SidebarNav';
import ThemeToggle from './ThemeToggle';
import TopBar from './TopBar';
import { NAV_GROUPS, filterNav } from './nav';
import type { SidebarMode } from './sidebar-state';
import './shell.css';

type AdminShellProps = {
  ctx: AdminContext;
  /** From the `sf_admin_sidebar` cookie: sets `data-sidebar` for first paint (T-16). */
  sidebarMode: SidebarMode;
  /** Thin site-wide notice under the top bar, e.g. the Firestore budget bar. */
  notice?: ReactNode;
  children: ReactNode;
};

/**
 * Admin frame: sidebar (rail / hover / pinned, drawer under 768 px), top bar,
 * content column. Server Component; only the interactive leaves are client.
 * Spec: docs/admin/02-design/03-layout-and-sidebar.md.
 */
export default function AdminShell({ ctx, sidebarMode, notice, children }: AdminShellProps) {
  // Items the role cannot use are hidden, not disabled. The pages still check.
  const groups = filterNav(NAV_GROUPS, (permission) => can(ctx.role, permission));

  return (
    <ShellFrame initialMode={sidebarMode}>
      <Sidebar
        brand={
          <span className="flex min-w-0 items-center gap-3">
            <Logo size={24} decorative className="admin-sb-mark size-6 shrink-0" />
            <span className="admin-sb-label flex min-w-0 items-baseline gap-2">
              <span className="font-display text-base font-bold tracking-tight text-fg">SyncFlow</span>
              <span className="label-mono">Admin</span>
            </span>
          </span>
        }
        nav={<SidebarNav groups={groups} idPrefix="sidebar" />}
        footer={
          <>
            <PinToggle />
            <ThemeToggle />
            <AccountMenu email={ctx.email} role={ctx.role} variant="sidebar" />
          </>
        }
      />
      <div className="admin-main flex min-w-0 flex-col">
        <TopBar
          email={ctx.email}
          role={ctx.role}
          drawerNav={<SidebarNav groups={groups} idPrefix="drawer" />}
          drawerFooter={<ThemeToggle />}
        />
        <OfflineBanner />
        {notice}
        <div id="admin-content" className="@container/main w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 xl:px-8">
          {children}
        </div>
      </div>
    </ShellFrame>
  );
}
