'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import AdminButton from '@/shared/ui/AdminButton';
import DeleteFilesDialog, { type DeleteActions } from './DeleteFilesDialog';

/**
 * Delete from the drawer or the full page. In the drawer (`inDrawer`) it goes
 * back to the table; on the full page it opens the list.
 */
type DeleteFileButtonProps = { id: string; label: string; inDrawer: boolean; actions: DeleteActions };

export default function DeleteFileButton({ id, label, inDrawer, actions }: DeleteFileButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <AdminButton variant="danger-solid" icon={Trash2} onClick={() => setOpen(true)}>
        Delete file
      </AdminButton>
      {open && (
        <DeleteFilesDialog
          open
          onOpenChange={setOpen}
          ids={[id]}
          label={label}
          actions={actions}
          onDone={() => {
            if (inDrawer) router.back();
            else router.push('/admin/files');
            router.refresh();
          }}
        />
      )}
    </>
  );
}
