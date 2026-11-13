import { Suspense } from 'react';
import type { Metadata } from 'next';
import { deleteFile, deleteFiles } from '@/features/admin/files/actions';
import FilesTable from '@/features/admin/files/components/FilesTable';
import { failureText } from '@/features/admin/files/components/FilesQueryState';
import StorageSummary, { StorageSummarySkeleton } from '@/features/admin/files/components/StorageSummary';
import { getStorageSummary, listFiles } from '@/features/admin/files/queries';
import { filesParamsSchema, type FilesParams } from '@/features/admin/files/schemas';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';
import { can } from '@/server/auth/permissions';
import type { AdminContext } from '@/server/auth/types';
import TableSkeleton from '@/shared/ui/data-table/TableSkeleton';
import { FIRST_PAGE_CURSOR } from '@/shared/ui/data-table/url-state';

export const metadata: Metadata = { title: 'Files & storage' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// 09-files-and-storage.md. Each panel streams in its own Suspense boundary,
// so a slow R2 call never holds up the table.
export default async function FilesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAdminPage('files:read', '/admin/files');
  const raw = await searchParams;
  const params = filesParamsSchema.parse({
    kind: first(raw.kind),
    expired: first(raw.expired),
    cursor: first(raw.cursor) || undefined,
  });

  return (
    <>
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-fg">Files &amp; storage</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Every stored file, as type, size and count only. No file names. The admin never opens, previews or downloads a
          file.
        </p>
      </header>
      <Suspense fallback={<StorageSummarySkeleton />}>
        <StoragePanel isOwner={ctx.role === 'owner'} />
      </Suspense>
      <Suspense fallback={<FilesSkeleton />}>
        <FilesPanel ctx={ctx} params={params} />
      </Suspense>
    </>
  );
}

async function StoragePanel({ isOwner }: { isOwner: boolean }) {
  return <StorageSummary summary={await getStorageSummary()} isOwner={isOwner} />;
}

async function FilesPanel({ ctx, params }: { ctx: AdminContext; params: FilesParams }) {
  const result = await listFiles(params, can(ctx.role, 'users:read'));
  const ok = result.state === 'ok';
  return (
    <FilesTable
      rows={ok ? result.rows : []}
      kind={params.kind}
      expired={params.expired}
      page={{ prevCursor: params.cursor ? FIRST_PAGE_CURSOR : null, nextCursor: ok ? result.nextCursor : null }}
      canDelete={can(ctx.role, 'files:delete')}
      actions={{ deleteFile, deleteFiles }}
      now={ok ? result.checkedAt : 0}
      error={ok ? undefined : failureText(result, ctx.role === 'owner')}
    />
  );
}

function FilesSkeleton() {
  return (
    <div className="rounded-lg border border-edge bg-surface">
      <TableSkeleton
        label="Loading files"
        selectable
        columns={[
          { id: 'type', label: 'Type', priority: 1, width: 112 },
          { id: 'size', label: 'Size', priority: 1, align: 'right', width: 96 },
          { id: 'uploader', label: 'Uploader', priority: 2 },
          { id: 'source', label: 'Room / link', priority: 2, width: 112 },
          { id: 'createdAt', label: 'Created', priority: 1, width: 104 },
        ]}
      />
    </div>
  );
}
