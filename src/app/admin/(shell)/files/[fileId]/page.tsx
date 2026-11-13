import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import DeleteFileButton from '@/features/admin/files/components/DeleteFileButton';
import FileDetail, { fileTitle } from '@/features/admin/files/components/FileDetail';
import FilesQueryState from '@/features/admin/files/components/FilesQueryState';
import { formatBytes } from '@/features/admin/files/format';
import { getFile } from '@/features/admin/files/queries';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';
import { can } from '@/server/auth/permissions';

export const metadata: Metadata = { title: 'File' };

// Direct load of /admin/files/[fileId] (shareable URL). A soft navigation
// from the table renders the drawer instead (@drawer/(.)[fileId]).
// `fileId` is the opaque id: no share token in the URL [D-4].
export default async function FilePage({ params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const ctx = await requireAdminPage('files:read', `/admin/files/${encodeURIComponent(fileId)}`);
  const result = await getFile(fileId, can(ctx.role, 'users:read'));
  if (result.state === 'not_found') notFound();

  return (
    <div className="max-w-xl">
      <Link href="/admin/files" className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted pointer-fine:hover:text-fg">
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="size-4" />
        Files &amp; storage
      </Link>
      {result.state === 'ok' ? (
        <>
          <h1 className="mb-4 text-xl font-semibold text-fg">{fileTitle(result.file)}</h1>
          <FileDetail
            file={result.file}
            now={result.checkedAt}
            actions={
              can(ctx.role, 'files:delete') ? (
                <DeleteFileButton id={result.file.id} label={`${fileTitle(result.file)} (${formatBytes(result.file.size)})`} inDrawer={false} />
              ) : undefined
            }
          />
        </>
      ) : (
        <FilesQueryState failure={result} isOwner={ctx.role === 'owner'} />
      )}
    </div>
  );
}
