import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isAdminRole } from '@/server/auth/permissions';
import { currentUser } from '@/shared/lib/firebase/session';
import AdminAuthFrame from '@/features/admin/auth/AdminAuthFrame';
import AdminSignInForm from '@/features/admin/auth/AdminSignInForm';
import { adminNextPath } from '@/features/admin/auth/admin-next';

export const metadata: Metadata = {
  title: 'Sign in to admin',
  robots: { index: false, follow: false },
};

/** `?notice=` values the shell and the account menu may send here. */
const NOTICES: Record<string, string> = {
  everywhere: 'Signed out on all devices.',
  disabled: 'This account has been disabled.',
};

type Props = { searchParams: Promise<{ next?: string | string[]; notice?: string | string[] }> };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Admin sign-in, outside the shell (docs/admin/03-features/01-auth.md).
 * No role check here beyond "already an admin → go on": this page is public.
 */
export default async function AdminSignInPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = adminNextPath(first(params.next));

  // Already signed in as an admin: skip the form. One verifySessionCookie
  // (revocation check, no Firestore) and only when a cookie is present. A
  // signed-in user without a role gets the form, to sign in as someone else.
  const user = await currentUser();
  if (user && isAdminRole(user.role)) redirect(next);

  const notice = NOTICES[first(params.notice) ?? ''] ?? null;

  return (
    <AdminAuthFrame>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-fg">Sign in to admin</h1>
        <p className="mt-1 text-sm text-fg-muted">We email you a one-time sign-in link.</p>
      </div>
      {notice && (
        <p role="status" className="mb-4 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-fg-muted">
          {notice}
        </p>
      )}
      <AdminSignInForm next={next} />
      <p className="mt-6 text-sm">
        <Link href="/" className="text-fg-muted hover:text-fg hover:underline">
          <span aria-hidden="true">←</span> Back to site
        </Link>
      </p>
    </AdminAuthFrame>
  );
}
