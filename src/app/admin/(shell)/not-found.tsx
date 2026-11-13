import Link from 'next/link';
import EmptyState from '@/shared/ui/EmptyState';
import NotFound from '@/shared/ui/illustrations/NotFound';
import CurrentPath from '@/features/admin/shell/CurrentPath';
import { BUTTON_SECONDARY } from '@/features/admin/shell/styles';

/** Unknown admin URL or a notFound() inside the shell. The shell and sidebar stay. */
export default function AdminNotFound() {
  return (
    <EmptyState
      size="page"
      titleAs="h1"
      illustration={<NotFound />}
      title="Page not found"
      body={
        <>
          There&apos;s no admin page at <CurrentPath />.
        </>
      }
      action={
        <Link href="/admin" className={BUTTON_SECONDARY}>
          Go to overview
        </Link>
      }
    />
  );
}
