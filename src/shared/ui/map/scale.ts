// Quantile colour scale for the world map (09-charts-and-maps.md): up to 6
// buckets over the countries with at least 1 visitor, coloured --seq-1 … --seq-6.
import { formatValue } from '../charts/format';

export const SEQ_STEPS = 6;

/** `lowers[i]` is the smallest value in bucket i (ascending). Values are whole counts. */
export type MapScale = { lowers: number[]; max: number };

/** Quantile buckets over the non-zero values. Null when no value is ≥ 1. */
export function buildScale(values: readonly number[], steps = SEQ_STEPS): MapScale | null {
  const sorted = values
    .map((v) => Math.round(v))
    .filter((v) => v >= 1)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const lowers = [sorted[0]];
  for (let i = 1; i < steps; i++) {
    const q = sorted[Math.floor((i * sorted.length) / steps)];
    if (q > lowers[lowers.length - 1]) lowers.push(q);
  }
  return { lowers, max: sorted[sorted.length - 1] };
}

/** Bucket of a value, or -1 for 0 (no visitors: drawn in --surface-2). */
export function bucketOf(scale: MapScale, value: number): number {
  const v = Math.round(value);
  if (v < 1) return -1;
  let i = 0;
  while (i + 1 < scale.lowers.length && scale.lowers[i + 1] <= v) i++;
  return i;
}

/** CSS colour of bucket i. Fewer than 6 buckets spread over the whole ramp, so the top bucket is always --seq-6. */
export function bucketColor(scale: MapScale, i: number): string {
  if (i < 0) return 'var(--surface-2)';
  const k = scale.lowers.length;
  const step = k === 1 ? SEQ_STEPS : Math.round((i * (SEQ_STEPS - 1)) / (k - 1)) + 1;
  return `var(--seq-${step})`;
}

/** Legend rows: "1–9", "10–49", … "500–1,204". */
export function legendItems(scale: MapScale): { label: string; color: string }[] {
  return scale.lowers.map((lo, i) => {
    const hi = i + 1 < scale.lowers.length ? scale.lowers[i + 1] - 1 : scale.max;
    const label = hi > lo ? `${formatValue(lo)}–${formatValue(hi)}` : formatValue(lo);
    return { label, color: bucketColor(scale, i) };
  });
}
