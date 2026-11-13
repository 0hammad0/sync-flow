'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import DeleteFilesDialog, { type DeleteActions } from './DeleteFilesDialog';

const DANGER_BUTTON =
  'inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-danger px-3 text-sm font-medium text-on-danger pointer-coarse:h-11 pointer-fine:hover:brightness-95';

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
      <button type="button" className={DANGER_BUTTON} onClick={() => setOpen(true)}>
        <Trash2 aria-hidden="true" strokeWidth={1.75} className="size-4" />
        Delete file
      </button>
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
