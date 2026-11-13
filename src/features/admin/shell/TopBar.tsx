import type { ReactNode } from 'react';
import type { AdminRole } from '@/server/auth/types';
import AccountMenu from './AccountMenu';
import Breadcrumbs from './Breadcrumbs';
import MobileNav from './MobileNav';

type TopBarProps = {
  email: string | null;
  role: AdminRole;
  /** Nav and footer for the < 768 px drawer. */
  drawerNav: ReactNode;
  drawerFooter: ReactNode;
};

/**
 * 56 px, sticky (48 px and not sticky on landscape phones). Left: ☰ (< 768)
 * and breadcrumbs. Right: the account avatar (< 768; the sidebar has it above).
 * Date range, ⌘K and the live count arrive with their phases.
 */
export default function TopBar({ email, role, drawerNav, drawerFooter }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-[var(--admin-topbar-h)] shrink-0 items-center gap-2 border-b border-edge bg-surface/90 px-4 sm:px-6 xl:px-8 short:static short:h-12">
      <MobileNav nav={drawerNav} footer={drawerFooter} />
      <Breadcrumbs />
      <div className="ml-auto flex items-center gap-2 md:hidden">
        <AccountMenu email={email} role={role} variant="compact" />
      </div>
    </header>
  );
}
