import { ChartPie } from 'lucide-react';
import EmptyState from '../EmptyState';
import BarList from './BarList';
import { formatShare, formatValue, type ValueFormat } from './format';

export type DonutPart = { label: string; value: number };

export type DonutProps = {
  /** What is split, e.g. "Devices". Starts the screen-reader sentence. */
  label: string;
  /**
   * In the fixed order of the palette (`--chart-1` … `--chart-4`), e.g. desktop,
   * mobile, tablet, other. Never sorted by value: colour follows the entity.
   * More than 4 parts renders a BarList instead.
   */
  parts: DonutPart[];
  /** Under the total in the middle. Default "Visitors". */
  centerLabel?: string;
  format?: ValueFormat;
  /** Default "No visits in this range". */
  emptyTitle?: string;
  className?: string;
};

const MAX_PARTS = 4;
const SIZE = 120;
const RING = 16;
const R = (SIZE - RING) / 2;
const CIRC = 2 * Math.PI * R;
const GAP = 2; // px of --surface between parts

export type DonutArc = { index: number; length: number; offset: number };

/** Arc length and start of each non-zero part on a ring of circumference `CIRC`, with a 2 px gap between parts. */
export function donutArcs(values: readonly number[]): DonutArc[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0) return [];
  const shown = values.map((v, index) => ({ v: Math.max(0, v), index })).filter((p) => p.v > 0);
  const gap = shown.length > 1 ? GAP : 0;
  let start = 0;
  return shown.map(({ v, index }) => {
    const span = (v / total) * CIRC;
    const arc = { index, length: Math.max(1.5, span - gap), offset: start };
    start += span;
    return arc;
  });
}

/**
 * Split of a whole in ≤ 4 parts (devices). Own SVG, Server Component, 0 KB JS.
 * 120 px ring, 16 px wide, total in the middle. The legend is real text
 * (swatch · label · share · count), to the right from 384 px of panel width,
 * below it under that. The ring is a `role="img"` figure with a sentence label.
 */
export default function Donut({
  label,
  parts,
  centerLabel = 'Visitors',
  format = 'count',
  emptyTitle = 'No visits in this range',
  className = '',
}: DonutProps) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  if (total <= 0) {
    return <EmptyState size="inline" icon={<ChartPie />} title={emptyTitle} className={className} />;
  }
  if (parts.length > MAX_PARTS) {
    return <BarList items={parts} format={format} max={parts.length} showShare className={className} />;
  }
  const sentence = `${label}: ${parts.map((p) => `${p.label} ${formatShare(p.value, total)}`).join(', ')}`;

  return (
    <div className={`@container ${className}`}>
      <div className="flex flex-col items-start gap-4 @sm:flex-row @sm:items-center @sm:gap-6">
        <figure role="img" aria-label={sentence} className="relative size-30 shrink-0">
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full -rotate-90" aria-hidden="true">
            {donutArcs(parts.map((p) => p.value)).map((arc) => (
              <circle
                key={arc.index}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                fill="none"
                stroke={`var(--chart-${arc.index + 1})`}
                strokeWidth={RING}
                strokeDasharray={`${arc.length.toFixed(2)} ${(CIRC - arc.length).toFixed(2)}`}
                strokeDashoffset={(-arc.offset).toFixed(2)}
              />
            ))}
          </svg>
          <figcaption aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[15px] leading-5 font-semibold text-fg tabular-nums">{formatValue(total, format)}</span>
            <span className="text-xs text-fg-muted">{centerLabel}</span>
          </figcaption>
        </figure>
        <ul className="flex w-full min-w-0 flex-col gap-1.5 text-[13px] @sm:w-auto @sm:flex-1">
          {parts.map((p, i) => (
            <li key={p.label} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-sm"
                style={{ background: `var(--chart-${i + 1})` }}
              />
              <span className="min-w-0 flex-1 truncate text-fg">{p.label}</span>
              <span className="w-12 text-right text-fg tabular-nums">{formatShare(p.value, total)}</span>
              <span className="min-w-12 text-right text-fg-muted tabular-nums">{formatValue(p.value, format)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
