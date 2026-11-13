import type { ReactNode } from 'react';
import Logo from '@/shared/components/Logo';

/**
 * The narrow column used by the admin sign-in and forbidden screens (no
 * shell). Phone: full width, 16 px sides. ≥ 640 px: 360 px, 15vh from the top.
 */
export default function AdminAuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[360px] px-4 py-8 sm:box-content sm:px-0 sm:pt-[15vh]">
      <p className="mb-8 flex items-center gap-2 text-sm font-semibold text-fg">
        <Logo size={20} decorative />
        <span>SyncFlow</span>
        <span className="font-mono text-[11px] font-medium tracking-wider text-fg-muted">ADMIN</span>
      </p>
      {children}
    </div>
  );
}
