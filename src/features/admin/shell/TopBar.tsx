import { Suspense, type ReactNode } from 'react';
import { OnlineNowDot } from '@/features/admin/live/components/OnlineNow';
import type { AdminRole } from '@/server/auth/types';
import AccountMenu from './AccountMenu';
import Breadcrumbs from './Breadcrumbs';
import DateRangePicker from './DateRangePicker';
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
 * Date range (analytics pages) and "N online" (≥ 1024 px, polled every 60 s).
 * ⌘K arrives with its phase.
 */
export default function TopBar({ email, role, drawerNav, drawerFooter }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-[var(--admin-topbar-h)] shrink-0 items-center gap-2 border-b border-edge bg-surface/90 px-4 sm:px-6 xl:px-8 short:static short:h-12">
      <MobileNav nav={drawerNav} footer={drawerFooter} />
      <Breadcrumbs />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* useSearchParams inside: its own boundary keeps the rest of the bar static. */}
        <Suspense fallback={null}>
          <DateRangePicker />
        </Suspense>
        <OnlineNowDot />
        <div className="flex items-center md:hidden">
          <AccountMenu email={email} role={role} variant="compact" />
        </div>
      </div>
    </header>
  );
}
