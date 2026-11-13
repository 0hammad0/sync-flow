import EmptyState from '@/shared/ui/EmptyState';
import ErrorState from '@/shared/ui/ErrorState';
import type { QueryFailure } from '../queries';

/** What a files query failure looks like on screen. */
export function failureText(failure: QueryFailure, isOwner: boolean): { title: string; reason: string; errorId?: string } {
  switch (failure.state) {
    case 'budget':
      return {
        title: 'Read budget used for today.',
        reason: 'Firestore reads for admin pages are paused until midnight Pacific, so chat keeps working.',
      };
    case 'setup':
      return {
        title: 'Files need a setup step.',
        reason: isOwner
          ? 'Add ADMIN_FILE_ID_KEY (32 random bytes, base64) in Vercel env, then redeploy.'
          : 'The owner needs to finish the Files setup.',
      };
    case 'index':
      return {
        title: 'Chat files need a Firestore index.',
        reason: 'Deploy firestore.indexes.json. Share files still work: pick Share above.',
      };
    case 'error':
      return { title: 'Could not load files.', reason: 'Firestore did not answer. Try again in a moment.', errorId: failure.errorId };
  }
}

/** Full-panel state for the detail page and drawer. */
export default function FilesQueryState({ failure, isOwner }: { failure: QueryFailure; isOwner: boolean }) {
  const text = failureText(failure, isOwner);
  if (failure.state === 'error') return <ErrorState size="panel" title={text.title} reason={text.reason} errorId={text.errorId} />;
  return <EmptyState size="panel" title={text.title} body={text.reason} />;
}
