import type { ReactNode } from 'react';
import Skeleton from '@/shared/ui/Skeleton';
import TableSkeleton, { type SkeletonColumn } from '@/shared/ui/data-table/TableSkeleton';

/** Title row shared by the loaded page and its skeleton, so nothing moves when data arrives. */
export function LiveHeader({ controls }: { controls?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-fg">Live</h1>
        <p className="mt-1 text-sm text-fg-muted">People on the site in the last 90 seconds.</p>
      </div>
      {controls && <div className="flex min-h-8 flex-wrap items-center gap-2">{controls}</div>}
    </header>
  );
}

const FEED_KEYS = Array.from({ length: 10 }, (_, i) => `f${i}`);
const VISITOR_COLUMNS: SkeletonColumn[] = [
  { id: 'location', label: 'Location', priority: 1 },
  { id: 'page', label: 'Page', priority: 1 },
  { id: 'time', label: 'Time on site', priority: 1, align: 'right', width: 104 },
  { id: 'ip', label: 'IP', priority: 2, width: 140 },
];

/** 03-live.md "Loading": 3 pills, a 260 px map block, an 8-row table, 10 feed rows. */
export default function LiveSkeleton() {
  return (
    <div aria-busy="true">
      <LiveHeader controls={<Skeleton className="h-5 w-32" />} />
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-5 w-20" shape="block" />
          <Skeleton className="h-5 w-20" shape="block" />
          <Skeleton className="h-5 w-20" shape="block" />
        </div>
        <div className="grid gap-4 lg:grid-cols-5">
          <Skeleton shape="block" className="h-[160px] sm:h-[220px] lg:col-span-2 lg:h-[260px]" />
          <div className="@container min-w-0 overflow-hidden rounded-lg border border-edge lg:col-span-3">
            <TableSkeleton label="Loading active visitors" columns={VISITOR_COLUMNS} rows={8} withActions />
          </div>
        </div>
        <ul className="flex flex-col gap-2">
          {FEED_KEYS.map((key) => (
            <li key={key} className="flex h-6 items-center gap-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="h-3 w-12" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
