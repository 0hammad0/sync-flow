import type { Metadata } from 'next';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import UsersTable from '@/features/admin/users/components/UsersTable';
import { listUsers, type UsersPage } from '@/features/admin/users/queries';
import { usersParamsSchema } from '@/features/admin/users/schemas';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';

export const metadata: Metadata = { title: 'Users' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// 13-users.md. A page view, so no blocklist read here (T-27); the user
// actions on the detail page do their own check.
export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAdminPage('users:read', '/admin/users');
  const raw = await searchParams;
  const params = usersParamsSchema.parse({
    filter: first(raw.filter),
    q: first(raw.q) || undefined,
    cursor: first(raw.cursor) || undefined,
  });

  let data: UsersPage | null = null;
  let error: { reason: string; errorId?: string } | undefined;
  try {
    data = await listUsers(params);
  } catch (e) {
    const errorId = crypto.randomUUID();
    console.error(`[admin] users list failed ${errorId}`, e);
    error = { reason: 'Firebase may be busy. Try again in a minute.', errorId };
  }

  return (
    <>
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-fg">Users</h1>
        <p className="mt-1 text-sm text-fg-muted">Accounts that signed in with an email link.</p>
      </header>
      <NuqsAdapter>
        <UsersTable
          rows={data?.rows ?? []}
          filter={params.filter}
          nextCursor={data?.nextCursor ?? null}
          selfUid={ctx.uid}
          nowMs={data?.checkedAt ?? 0}
          error={error}
        />
      </NuqsAdapter>
    </>
  );
}
