import type { Metadata } from 'next';
import Link from 'next/link';
import UserDetail from '@/features/admin/users/components/UserDetail';
import { getUserDetail, type UserDetailPage } from '@/features/admin/users/queries';
import { UID_PATTERN } from '@/features/admin/users/schemas';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';
import ErrorState from '@/shared/ui/ErrorState';
import { can } from '@/server/auth/permissions';

export const metadata: Metadata = { title: 'User' };

type Params = Promise<{ uid: string }>;

function Gone() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-fg">User not found</h1>
      <p className="mt-1 text-sm text-fg-muted">This user no longer exists.</p>
      <p className="mt-4 text-sm">
        <Link href="/admin/users" className="text-brand-text hover:underline">
          Back to users
        </Link>
      </p>
    </div>
  );
}

// 13-users.md detail. File count and storage only, never file names [D-6].
export default async function UserPage({ params }: { params: Params }) {
  const { uid } = await params;
  const ctx = await requireAdminPage('users:read', `/admin/users/${encodeURIComponent(uid)}`);
  if (!UID_PATTERN.test(uid)) return <Gone />;

  let data: UserDetailPage | null = null;
  let errorId: string | null = null;
  try {
    data = await getUserDetail(uid);
  } catch (e) {
    errorId = crypto.randomUUID();
    console.error(`[admin] user detail failed ${errorId}`, e);
  }
  if (errorId) return <ErrorState title="Could not load this user." reason="Firebase may be busy. Try again in a minute." errorId={errorId} />;
  if (!data?.user) return <Gone />;

  return (
    <UserDetail
      user={data.user}
      isSelf={data.user.uid === ctx.uid}
      can={{
        disable: can(ctx.role, 'users:disable'),
        revoke: can(ctx.role, 'users:revoke'),
        roles: can(ctx.role, 'roles:write'),
      }}
      adminEmail={ctx.email}
      nowMs={data.checkedAt}
    />
  );
}
