import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './admin.css';

// Every /admin page, including /admin/sign-in. No auth here: the sign-in page
// lives under this layout. The shell and its requireAdmin are in (shell)/.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  // `data-admin-root` hides the public header/footer (admin.css). `contents`
  // keeps this wrapper out of layout.
  return (
    <div data-admin-root="" className="contents">
      {children}
    </div>
  );
}
