import SessionsSkeleton from '@/features/admin/sessions/components/SessionsSkeleton';
import Skeleton from '@/shared/ui/Skeleton';

/** Sessions list while the page loads: real title, 10 skeleton rows. */
export default function SessionsLoading() {
  return (
    <div aria-busy="true">
      <h1 className="text-xl font-semibold text-fg">Sessions</h1>
      <Skeleton className="mt-2 mb-4 h-4 w-72 max-w-full" />
      <SessionsSkeleton />
    </div>
  );
}
