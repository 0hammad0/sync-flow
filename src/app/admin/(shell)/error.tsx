'use client';

import { useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import ErrorState from '@/shared/ui/ErrorState';
import AdminButton from '@/shared/ui/AdminButton';

type AdminErrorProps = { error: Error & { digest?: string }; retry: () => void };

/** Reason line by error kind (06-states.md 6.3). */
function reasonFor(error: AdminErrorProps['error']): string {
  if (error.digest) return 'The server hit an error. It has been logged.';
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return 'The connection dropped before the data arrived.';
  }
  return 'Something on this page failed to load. Retry, or copy the error id if it keeps happening.';
}

/** A page inside the shell failed. The shell and sidebar stay. */
export default function AdminError({ error, retry }: AdminErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      size="page"
      titleAs="h1"
      title="Couldn't load this page"
      reason={reasonFor(error)}
      errorId={error.digest}
      action={
        <AdminButton icon={RotateCcw} onClick={() => retry()}>
          Retry
        </AdminButton>
      }
    />
  );
}
