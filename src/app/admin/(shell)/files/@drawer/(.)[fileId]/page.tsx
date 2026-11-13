import { deleteFile, deleteFiles } from '@/features/admin/files/actions';
import DeleteFileButton from '@/features/admin/files/components/DeleteFileButton';
import FileDetail, { fileTitle } from '@/features/admin/files/components/FileDetail';
import FileDrawer from '@/features/admin/files/components/FileDrawer';
import FilesQueryState from '@/features/admin/files/components/FilesQueryState';
import { formatBytes } from '@/features/admin/files/format';
import { getFile } from '@/features/admin/files/queries';
import { requireAdminPage } from '@/features/admin/shell/require-admin-page';
import { can } from '@/server/auth/permissions';

// Soft navigation from the files table: the same detail, in a drawer over
// the table. Close = router.back(). Same permission as the full page.
export default async function FileDrawerPage({ params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const ctx = await requireAdminPage('files:read', `/admin/files/${encodeURIComponent(fileId)}`);
  const result = await getFile(fileId, can(ctx.role, 'users:read'));

  if (result.state !== 'ok') {
    return (
      <FileDrawer title="File">
        {result.state === 'not_found' ? (
          <p className="text-sm text-fg-muted">File not found. It may have been deleted.</p>
        ) : (
          <FilesQueryState failure={result} isOwner={ctx.role === 'owner'} />
        )}
      </FileDrawer>
    );
  }

  const title = fileTitle(result.file);
  return (
    <FileDrawer title={title}>
      <FileDetail
        file={result.file}
        now={result.checkedAt}
        actions={
          can(ctx.role, 'files:delete') ? (
            <DeleteFileButton id={result.file.id} label={`${title} (${formatBytes(result.file.size)})`} actions={{ deleteFile, deleteFiles }} inDrawer />
          ) : undefined
        }
      />
    </FileDrawer>
  );
}
