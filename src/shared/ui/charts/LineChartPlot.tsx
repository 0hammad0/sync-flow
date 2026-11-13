'use client';

// The Recharts part of LineChart. Loaded only through LineChart (next/dynamic),
// so Recharts lands in its own lazy chunk. Colours are CSS variables, so a
// theme switch repaints without touching the data.
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import Delta from './Delta';
import { formatBucketLabel, formatBucketTick, formatTick, formatValue, type Bucket, type ValueFormat } from './format';
import { SeriesKey } from './SeriesKey';
import type { LinePoint } from './LineChart';

export type LineChartPlotProps = {
  data: LinePoint[];
  bucket: Bucket;
  timeZone: string;
  format: ValueFormat;
  area: boolean;
  hasCompare: boolean;
  seriesLabel: string;
  compareLabel: string;
  higherIsBetter: boolean;
};

const AXIS_TICK = { fill: 'var(--fg-faint)', fontSize: 11 } as const;
const MAX_X_TICKS = 6;

/** Up to `max` evenly spaced bucket starts, always the first and the last. */
export function pickTicks(ts: readonly number[], max = MAX_X_TICKS): number[] {
  if (ts.length <= max) return [...ts];
  const step = (ts.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => ts[Math.round(i * step)]);
}

export default function LineChartPlot({
  data,
  bucket,
  timeZone,
  format,
  area,
  hasCompare,
  seriesLabel,
  compareLabel,
  higherIsBetter,
}: LineChartPlotProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} accessibilityLayer={false} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--edge)" />
        <XAxis
          dataKey="t"
          ticks={pickTicks(data.map((p) => p.t))}
          axisLine={false}
          tickLine={false}
          tick={AXIS_TICK}
          tickMargin={8}
          interval="preserveStartEnd"
          minTickGap={24}
          tickFormatter={(t: number) => formatBucketTick(t, bucket, timeZone)}
        />
        <YAxis
          width="auto"
          axisLine={false}
          tickLine={false}
          tick={AXIS_TICK}
          tickCount={4}
          allowDecimals={format !== 'count'}
          tickFormatter={(v: number) => formatTick(v, format)}
          className="tabular-nums"
        />
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: 'var(--edge-strong)', strokeWidth: 1 }}
          content={(props) => (
            <PlotTooltip
              {...props}
              bucket={bucket}
              timeZone={timeZone}
              format={format}
              hasCompare={hasCompare}
              seriesLabel={seriesLabel}
              compareLabel={compareLabel}
              higherIsBetter={higherIsBetter}
            />
          )}
        />
        {hasCompare && (
          <Line
            dataKey="compare"
            stroke="var(--fg-faint)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            activeDot={false}
            connectNulls
            isAnimationActive={false}
          />
        )}
        {area && (
          <Area dataKey="value" stroke="none" fill="var(--chart-1)" fillOpacity={0.08} activeDot={false} isAnimationActive={false} />
        )}
        <Line
          dataKey="value"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: 'var(--chart-1)', stroke: 'var(--surface)', strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

type PlotTooltipProps = Pick<TooltipContentProps, 'active' | 'payload'> &
  Pick<LineChartPlotProps, 'bucket' | 'timeZone' | 'format' | 'hasCompare' | 'seriesLabel' | 'compareLabel' | 'higherIsBetter'>;

function PlotTooltip({ active, payload, bucket, timeZone, format, hasCompare, seriesLabel, compareLabel, higherIsBetter }: PlotTooltipProps) {
  const point = payload?.[0]?.payload as LinePoint | undefined;
  if (!active || !point) return null;
  const compare = hasCompare && typeof point.compare === 'number' ? point.compare : null;
  return (
    <div className="min-w-44 rounded-md border border-edge bg-surface px-3 py-2 text-xs text-fg shadow-[var(--shadow-float)]">
      <p className="mb-1.5 font-medium">{formatBucketLabel(point.t, bucket, timeZone)}</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
        <dt className="flex items-center gap-1.5 text-fg-muted">
          <SeriesKey kind="series" />
          {seriesLabel}
        </dt>
        <dd className="text-right font-medium">{formatValue(point.value, format)}</dd>
        {compare !== null && (
          <>
            <dt className="flex items-center gap-1.5 text-fg-muted">
              <SeriesKey kind="compare" />
              {compareLabel}
            </dt>
            <dd className="text-right">{formatValue(compare, format)}</dd>
            <dt className="pl-[22px] text-fg-muted">Change</dt>
            <dd className="text-right">
              <Delta value={point.value} previous={compare} higherIsBetter={higherIsBetter} />
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
