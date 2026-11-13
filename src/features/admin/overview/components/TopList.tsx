import type { ReactNode } from 'react';
import Badge from '@/shared/ui/Badge';
import Skeleton from '@/shared/ui/Skeleton';
import BarList, { type BarListItem } from '@/shared/ui/charts/BarList';

// Top pages / countries / sources on the Overview (02-overview.md "Top lists"):
// 8 rows from 640 px, 5 on phones. The panel and its title render at once;
// only the list streams in.

/** Rows 6–8 are dropped under 640 px. */
const PHONE_ROWS = 'max-sm:[&_li:nth-child(n+6)]:hidden';

type FrameProps = { id: string; title: string; children: ReactNode };

export function TopListFrame({ id, title, children }: FrameProps) {
  return (
    <section aria-labelledby={id} className="relative flex min-w-0 flex-col rounded-lg border border-edge bg-surface p-4">
      <h2 id={id} className="mb-2 flex min-h-5 items-center text-sm font-semibold text-fg">
        {title}
      </h2>
      {children}
    </section>
  );
}

type TopListProps = {
  items: BarListItem[];
  /** Sum the shares are taken from. */
  total?: number;
  viewAllHref: string;
  /** Some day in range had sampling on: badge in the panel's top-right corner. */
  sampled?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
};

export default function TopList({ items, total, viewAllHref, sampled = false, emptyTitle, emptyBody }: TopListProps) {
  return (
    <>
      {sampled && <Badge tone="warning" className="absolute top-4 right-4">Sampled</Badge>}
      <BarList
        items={items}
        max={8}
        total={total}
        showShare
        viewAllHref={items.length > 0 ? viewAllHref : undefined}
        emptyTitle={emptyTitle}
        emptyBody={emptyBody}
        className={PHONE_ROWS}
      />
    </>
  );
}

const ROW_KEYS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'];

/** 8 rows of 2 bars (60% / 15%) at 32 px. */
export function TopListSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className={PHONE_ROWS}>
      <span className="sr-only">Loading {label}</span>
      <ol className="flex flex-col gap-0.5">
        {ROW_KEYS.map((key) => (
          <li key={key} className="flex h-8 items-center justify-between gap-4 px-2">
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-3 w-[15%]" />
          </li>
        ))}
      </ol>
    </div>
  );
}
