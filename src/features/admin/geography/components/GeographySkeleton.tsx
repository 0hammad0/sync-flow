import Skeleton from '@/shared/ui/Skeleton';
import TableSkeleton, { CardListSkeleton } from '@/shared/ui/data-table/TableSkeleton';

/** MAP + T (06-states.md section 7). Phones: the table first, the map closed. */
export default function GeographySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-5 w-40" />
      <div className="order-2 rounded-lg border border-edge bg-surface sm:order-1">
        <div className="flex h-11 items-center px-3">
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="hidden border-t border-edge p-4 sm:block">
          <Skeleton shape="block" className="mx-auto aspect-[2/1] w-full max-w-4xl opacity-50" />
        </div>
      </div>
      <div className="order-1 rounded-lg border border-edge bg-surface @container sm:order-2">
        <div className="hidden @[640px]:block">
          <TableSkeleton
            label="Loading places"
            columns={[
              { id: 'place', label: 'Place', priority: 1 },
              { id: 'visitors', label: 'Visitors', priority: 1, align: 'right', width: 96 },
              { id: 'pageviews', label: 'Page views', priority: 2, align: 'right', width: 104 },
              { id: 'avg_time', label: 'Avg time', priority: 2, align: 'right', width: 96 },
              { id: 'bounce', label: 'Bounce', priority: 3, align: 'right', width: 88 },
              { id: 'share', label: 'Share', priority: 1, align: 'right', width: 104 },
            ]}
          />
        </div>
        <div className="@[640px]:hidden">
          <CardListSkeleton label="Loading places" />
        </div>
      </div>
    </div>
  );
}
