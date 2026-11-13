import Skeleton from '@/shared/ui/Skeleton';

const KPI_KEYS = ['k1', 'k2', 'k3', 'k4'];

/** Content-area skeleton while a page loads. The shell stays on screen. */
export default function AdminLoading() {
  return (
    <div aria-busy="true">
      <span role="status" className="sr-only">
        Loading page
      </span>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      <div className="mt-6 grid grid-cols-1 gap-4 @[340px]/main:grid-cols-2 @2xl/main:grid-cols-4">
        {KPI_KEYS.map((key) => (
          <Skeleton key={key} shape="block" className="h-32" />
        ))}
      </div>
      <Skeleton shape="block" className="mt-4 h-60" />
    </div>
  );
}
