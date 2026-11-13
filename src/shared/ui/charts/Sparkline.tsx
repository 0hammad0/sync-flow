const W = 100;
const H = 28;
const PAD = 1.5; // keeps the 1.5 px stroke inside the box at the peak and the floor

/** SVG path for values scaled into a 100 × 28 box. Flat line at the bottom when there is nothing to show. */
export function sparklinePath(values: readonly number[]): { d: string; flat: boolean } {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  if (values.length < 2 || max === min) return { d: `M0 ${H - PAD}H${W}`, flat: true };
  const step = W / (values.length - 1);
  const y = (v: number) => PAD + (1 - (v - min) / (max - min)) * (H - 2 * PAD);
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${+(i * step).toFixed(2)} ${+y(v).toFixed(2)}`).join('');
  return { d, flat: false };
}

type SparklineProps = {
  /** Same buckets as the main chart, oldest first. */
  values: readonly number[];
  /** Layout only. Default size is full width × 28 px. */
  className?: string;
};

/**
 * Trend at a glance for a KPI card. Server Component, 0 KB JS: one `<path>`,
 * 1.5 px `--chart-1`, no axes, dots or tooltip. Flat `--edge` line when empty.
 * `aria-hidden`: the card text carries the value and the change.
 */
export default function Sparkline({ values, className = '' }: SparklineProps) {
  const { d, flat } = sparklinePath(values);
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={`block h-7 w-full overflow-visible ${className}`}
    >
      <path
        d={d}
        fill="none"
        stroke={flat ? 'var(--edge)' : 'var(--chart-1)'}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
