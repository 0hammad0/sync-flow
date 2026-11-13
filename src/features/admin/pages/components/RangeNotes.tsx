import { CircleAlert } from 'lucide-react';
import { formatDay } from '@/features/admin/analytics/range';
import type { RangeMeta } from '@/features/admin/analytics/types';
import Badge from '@/shared/ui/Badge';
import Tooltip from '@/shared/ui/Tooltip';

// Notes about the data behind a rollup screen (Pages, Sources): the
// "sampled" badge (02-overview.md "Sampled days") and days still being built.

export const SAMPLED_HINT = 'Some sessions were skipped to stay in the free Firestore budget; counts were scaled ×2.';

/** Nothing when the range is plain. */
export default function RangeNotes({ meta }: { meta: RangeMeta }) {
  const fallback = meta.fallbackDays;
  if (!meta.sampled && fallback.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-muted">
      {meta.sampled && (
        <Tooltip content={SAMPLED_HINT}>
          <button type="button" className="cursor-default rounded-full" aria-label={`Sampled. ${SAMPLED_HINT}`}>
            <Badge tone="warning" icon={CircleAlert}>
              Sampled
            </Badge>
          </button>
        </Tooltip>
      )}
      {fallback.length > 0 && (
        <span>
          {fallback.length === 1 ? formatDay(fallback[0]) : `${fallback.length} days`} may be incomplete. The daily total is
          still being built.
        </span>
      )}
    </div>
  );
}
