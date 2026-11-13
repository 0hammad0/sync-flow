'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { ChartLine, Table2, TrendingUp } from 'lucide-react';
import Badge from '../Badge';
import EmptyState from '../EmptyState';
import SegmentedControl from '../SegmentedControl';
import Delta from './Delta';
import { formatBucketLabel, formatValue, type Bucket, type ValueFormat } from './format';
import { CHART_HEIGHT, ChartSkeleton, ChunkBoundary, useRetryableChunk } from './lazy-chunk';
import { SeriesKey } from './SeriesKey';

/** One bucket. `t` = bucket start in epoch ms. `compare` = same bucket of the previous period. */
export type LinePoint = { t: number; value: number; compare?: number | null };

export type LineChartProps = {
  /** What is measured, e.g. "Visitors". Table caption and first value column. */
  label: string;
  data: LinePoint[];
  /**
   * One sentence read by screen readers instead of the plot, built on the server:
   * "Visitors, last 7 days: 1,204 total, up 12.4% from the previous 7 days. Peak 312 on 11 Nov."
   */
  summary: string;
  bucket: Bucket;
  /** IANA zone the buckets are in. Default `UTC` (rollups are UTC). */
  timeZone?: string;
  /** Default `count`. */
  format?: ValueFormat;
  /** Flat 8% fill under the line. */
  area?: boolean;
  /** Default "This period". */
  seriesLabel?: string;
  /** Default "Previous". */
  compareLabel?: string;
  /** Colour of the change in tooltip and table. Default true (up is good). */
  higherIsBetter?: boolean;
  /** Some days in range were sampled (`a_daily.sampled`): shows a "Sampled" badge. */
  sampled?: boolean;
  /** New data is loading: old chart at 60% + 2 px bar. */
  refreshing?: boolean;
  /** Default "No visits in this range". */
  emptyTitle?: string;
  emptyBody?: string;
  /** Layout only. */
  className?: string;
};

type View = 'chart' | 'table';

const createPlot = () =>
  dynamic(() => import('./LineChartPlot'), { ssr: false, loading: () => <ChartSkeleton /> });
const FirstPlot = createPlot();

/**
 * Trend over time: 1 series (`--chart-1`) plus an optional dashed compare
 * period (`--fg-faint`). The Recharts plot is a lazy chunk with a same-size
 * skeleton; the frame (key, Chart/Table switch, table, empty state) renders
 * at once. Screen readers get `summary` on a `role="img"` figure; the Table
 * view is a real `<table>` of the same data at the same height.
 */
export default function LineChart({
  label,
  data,
  summary,
  bucket,
  timeZone = 'UTC',
  format = 'count',
  area = false,
  seriesLabel = 'This period',
  compareLabel = 'Previous',
  higherIsBetter = true,
  sampled = false,
  refreshing = false,
  emptyTitle = 'No visits in this range',
  emptyBody,
  className = '',
}: LineChartProps) {
  const [view, setView] = useState<View>('chart');
  const [Plot, retry] = useRetryableChunk(FirstPlot, createPlot);
  const hasCompare = data.some((p) => typeof p.compare === 'number');
  const empty = data.every((p) => p.value === 0 && !p.compare);

  return (
    <div aria-busy={refreshing || undefined} className={`relative flex flex-col gap-2 ${className}`}>
      {refreshing && <span aria-hidden="true" className="absolute inset-x-0 -top-px h-0.5 bg-brand" />}
      {!empty && (
        <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
            {hasCompare && (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <SeriesKey kind="series" />
                  {seriesLabel}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <SeriesKey kind="compare" />
                  {compareLabel}
                </span>
              </>
            )}
            {sampled && <Badge>Sampled</Badge>}
          </div>
          <SegmentedControl
            label={`${label}: show as`}
            size="sm"
            value={view}
            onValueChange={setView}
            items={[
              { value: 'chart', label: 'Chart', icon: ChartLine },
              { value: 'table', label: 'Table', icon: Table2 },
            ]}
            className="ml-auto"
          />
        </div>
      )}
      <div className={`relative ${CHART_HEIGHT} ${refreshing ? 'opacity-60' : ''}`}>
        {empty ? (
          <div className="flex h-full items-center border-b border-edge">
            <EmptyState size="inline" icon={<TrendingUp />} title={emptyTitle} body={emptyBody} />
          </div>
        ) : view === 'table' ? (
          <LineTable
            label={label}
            data={data}
            bucket={bucket}
            timeZone={timeZone}
            format={format}
            hasCompare={hasCompare}
            seriesLabel={seriesLabel}
            compareLabel={compareLabel}
            higherIsBetter={higherIsBetter}
          />
        ) : (
          <figure role="img" aria-label={summary} className="h-full">
            <ChunkBoundary title="Couldn't load this chart." onRetry={retry}>
              <Plot
                data={data}
                bucket={bucket}
                timeZone={timeZone}
                format={format}
                area={area}
                hasCompare={hasCompare}
                seriesLabel={seriesLabel}
                compareLabel={compareLabel}
                higherIsBetter={higherIsBetter}
              />
            </ChunkBoundary>
          </figure>
        )}
      </div>
    </div>
  );
}

/** Loading state for a whole LineChart (e.g. a Suspense fallback): same height as the chart box. */
export function LineChartSkeleton({ label = 'chart', className = '' }: { label?: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div aria-hidden="true" className="h-7" />
      <div className={CHART_HEIGHT}>
        <ChartSkeleton label={label} />
      </div>
    </div>
  );
}

type LineTableProps = Required<
  Pick<LineChartProps, 'label' | 'data' | 'bucket' | 'timeZone' | 'format' | 'seriesLabel' | 'compareLabel' | 'higherIsBetter'>
> & { hasCompare: boolean };

function LineTable({ label, data, bucket, timeZone, format, hasCompare, seriesLabel, compareLabel, higherIsBetter }: LineTableProps) {
  const head = 'sticky top-0 bg-surface-2 px-3 py-2 text-left text-xs font-medium text-fg-muted';
  return (
    <div className="h-full overflow-auto rounded-md border border-edge">
      <table className="w-full border-collapse text-[13px] tabular-nums">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            <th scope="col" className={head}>
              Date
            </th>
            <th scope="col" className={`${head} text-right`}>
              {hasCompare ? seriesLabel : label}
            </th>
            {hasCompare && (
              <>
                <th scope="col" className={`${head} text-right`}>
                  {compareLabel}
                </th>
                <th scope="col" className={`${head} text-right`}>
                  Change
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {data.map((p) => (
            <tr key={p.t} className="border-t border-edge">
              <th scope="row" className="px-3 py-1.5 text-left font-normal whitespace-nowrap text-fg">
                {formatBucketLabel(p.t, bucket, timeZone)}
              </th>
              <td className="px-3 py-1.5 text-right text-fg">{formatValue(p.value, format)}</td>
              {hasCompare && (
                <>
                  <td className="px-3 py-1.5 text-right text-fg-muted">
                    {typeof p.compare === 'number' ? formatValue(p.compare, format) : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {typeof p.compare === 'number' ? (
                      <Delta value={p.value} previous={p.compare} higherIsBetter={higherIsBetter} />
                    ) : (
                      <span className="text-fg-faint">—</span>
                    )}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
