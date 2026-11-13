'use client';

import { useState } from 'react';
import { signOutAdmin } from '@/features/admin/auth/sign-out';
import { blockedError } from '@/shared/lib/blocked';
import ConfirmDialog, { type ConfirmResult } from '@/shared/ui/ConfirmDialog';
import type { deleteFile, deleteFiles } from '../actions';
import { MAX_FILES_PER_DELETE, TYPE_TO_CONFIRM_OVER } from '../constants';

/** sonner loads lazily (LazyToaster), so import it on use. */
export async function toast(kind: 'success' | 'error', title: string, description?: string) {
  const { toast: t } = await import('sonner');
  t[kind](title, description ? { description } : undefined);
}

export type DeleteOutcome = { deleted: string[]; gone: string[]; failed: string[] };

/**
 * The delete server actions, passed down as props from the server page, not
 * imported here: a client import of the actions module in the drawer's
 * parallel-route chunk made Turbopack split the shared server-action runtime
 * chunk, adding ~0.3 KiB gz to every public page.
 */
export type DeleteActions = { deleteFile: typeof deleteFile; deleteFiles: typeof deleteFiles };

type DeleteFilesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opaque file ids. One id → `deleteFile`, more → `deleteFiles`. */
  ids: string[];
  /** "PDF, 2.4 MB" for one file. Never a file name (D-6). */
  label: string;
  /** Called after the action returns, before the dialog closes. */
  onDone: (outcome: DeleteOutcome) => void;
  actions: DeleteActions;
};

const STEP_UP = 'Deleting needs a sign-in from the last 15 minutes. Sign out, sign in again, then retry.';

function failureMessage(result: { error: string; message?: string; errorId?: string }): string {
  switch (result.error) {
    case 'blocked':
      return blockedError(result) ?? "You can't do this right now.";
    case 'step_up_required':
      return STEP_UP;
    case 'forbidden':
      return 'Your role cannot delete files.';
    case 'not_found':
      return 'This file was already deleted.';
    case 'invalid':
      return `Select between 1 and ${MAX_FILES_PER_DELETE} files.`;
    default:
      return `Could not delete. Nothing was changed for the files that failed.${result.errorId ? ` Error id ${result.errorId}.` : ''}`;
  }
}

/** Confirm, then delete. Type-to-confirm `DELETE` above 10 files (09-files-and-storage.md "Actions"). */
export default function DeleteFilesDialog({ open, onOpenChange, ids, label, onDone, actions }: DeleteFilesDialogProps) {
  const { deleteFile, deleteFiles } = actions;
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const many = ids.length > 1;

  const run = async (): Promise<ConfirmResult> => {
    setNeedsSignIn(false);
    if (!many) {
      const result = await deleteFile({ id: ids[0] });
      if (result.ok) {
        onDone({ deleted: ids, gone: [], failed: [] });
        void toast('success', 'File deleted.');
        return { ok: true };
      }
      if (result.error === 'step_up_required') setNeedsSignIn(true);
      if (result.error === 'not_found') {
        onDone({ deleted: [], gone: ids, failed: [] });
        void toast('error', 'This file was already deleted.');
        return { ok: true };
      }
      return { ok: false, error: result.error, message: failureMessage(result) };
    }

    const result = await deleteFiles({ ids });
    if (!result.ok) {
      if (result.error === 'step_up_required') setNeedsSignIn(true);
      return { ok: false, error: result.error, message: failureMessage(result) };
    }
    const { deleted, missing, failed } = result.data;
    onDone({ deleted, gone: missing, failed });
    const done = deleted.length + missing.length;
    if (failed.length === 0) void toast('success', `Deleted ${done} ${done === 1 ? 'file' : 'files'}.`);
    else void toast('error', `Deleted ${done} of ${ids.length} files. ${failed.length} failed.`, 'The failed files are still stored. Try them again.');
    return { ok: true };
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setNeedsSignIn(false);
        onOpenChange(next);
      }}
      title={many ? `Delete ${ids.length} files?` : `Delete ${label}?`}
      consequence={
        many
          ? 'The files are removed from storage for good. Their links stop working. This cannot be undone.'
          : 'The file is removed from storage for good. Its link stops working. This cannot be undone.'
      }
      confirmLabel={many ? `Delete ${ids.length} files` : 'Delete file'}
      tone="danger"
      typeToConfirm={ids.length > TYPE_TO_CONFIRM_OVER ? 'DELETE' : undefined}
      onConfirm={run}
    >
      {needsSignIn && (
        // The sign-in page sends a signed-in admin straight on, so a fresh
        // sign-in needs a sign-out first (no in-place step-up dialog yet).
        <button
          type="button"
          onClick={() => void signOutAdmin()}
          className="self-start text-sm font-medium text-brand-text underline underline-offset-2"
        >
          Sign out and sign in again
        </button>
      )}
    </ConfirmDialog>
  );
}
