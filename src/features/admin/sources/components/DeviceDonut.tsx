import type { BreakdownRow } from '@/features/admin/analytics/types';
import Donut from '@/shared/ui/charts/Donut';
import Skeleton from '@/shared/ui/Skeleton';
import { DIM_HEADERS, type SourceDimKey } from '../constants';
import { donutParts } from '../rows';

/**
 * Share donut for Devices, Browsers and OS (08-sources.md). Server-rendered
 * SVG, no chart JS. Hidden under 640 px: the cards already show each share.
 * `aria-hidden`: the table next to it has the same numbers.
 */
export default function DeviceDonut({ dim, rows }: { dim: SourceDimKey; rows: BreakdownRow[] }) {
  return (
    <section aria-hidden="true" className="hidden rounded-lg border border-edge bg-surface p-4 sm:block">
      <h2 className="mb-3 text-[13px] font-medium text-fg">Share of visitors</h2>
      <Donut label={DIM_HEADERS[dim]} parts={donutParts(dim, rows)} centerLabel="Visitors" />
    </section>
  );
}

export function DeviceDonutSkeleton() {
  return (
    <div className="hidden rounded-lg border border-edge bg-surface p-4 sm:block">
      <Skeleton className="mb-3 h-3.5 w-28" />
      <Skeleton shape="circle" className="size-30" />
    </div>
  );
}
