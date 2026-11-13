import { formatDay, type ResolvedRange } from '@/features/admin/analytics/range';
import type { TrendDto } from '@/features/admin/analytics/types';
import LineChart from '@/shared/ui/charts/LineChart';
import { dataStartDay, trendPoints, trendSummary } from '../trend';

/**
 * Visitors over time with the previous period dashed. The Recharts plot is a
 * lazy chunk inside LineChart (loads after the frame, same-size skeleton).
 * When tracking started inside the range, a line under the chart says so,
 * so the flat start reads as "no data yet", not as a broken chart.
 */
export default function TrendChart({ trend, range }: { trend: TrendDto; range: ResolvedRange }) {
  const start = dataStartDay(trend);
  return (
    <div className="flex flex-col gap-2">
      <LineChart
        label="Visitors"
        data={trendPoints(trend)}
        summary={trendSummary(trend, range)}
        bucket={trend.granularity}
        area
        sampled={trend.meta.sampled}
        emptyTitle="No visits in this range"
        emptyBody="Pick a longer range."
      />
      {start && <p className="text-xs text-fg-muted">No data before {formatDay(start)}. Earlier days show as 0.</p>}
    </div>
  );
}
