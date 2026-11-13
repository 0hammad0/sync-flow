import { formatDaySpan } from '@/features/admin/analytics/range';
import { formatDuration, formatValue } from '@/shared/ui/charts/format';

// Display helpers for rollup rows (Pages, Sources). Pure, server and client.

/** 0..1 fraction → `41.2%`; `null` (nothing to divide by) → null, which the table shows as `—`. */
export function formatRate(rate: number | null): string | null {
  return rate === null ? null : formatValue(rate * 100, 'percent');
}

/** Screen-reader text for a rate: "41.2 percent". */
export function spokenRate(rate: number | null): string | undefined {
  return rate === null ? undefined : `${formatValue(rate * 100, 'percent').replace('%', '')} percent`;
}

/** Average visible time from ms: `45s`, `6m 10s`. Zero stays `0s` (all bounces), not a dash. */
export function formatAvgTime(ms: number | null): string | null {
  return ms === null ? null : formatDuration(ms / 1000);
}

/** Scroll depth, already 0..100: `62%`. */
export function formatScroll(value: number | null): string | null {
  return value === null ? null : `${Math.round(value)}%`;
}

/** `1 visitor`, `2 visitors`. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/** "Based on the latest 500 sessions, 16 Oct – 14 Nov 2026." */
export function sampleNote(sample: { sampleSize: number; from: string; to: string }, cap = 500): string {
  const span = formatDaySpan(sample.from, sample.to);
  if (sample.sampleSize === 0) return `No sessions in ${span}.`;
  return sample.sampleSize >= cap
    ? `Based on the latest ${sample.sampleSize.toLocaleString('en-US')} sessions, ${span}.`
    : `Based on all ${plural(sample.sampleSize, 'session')}, ${span}.`;
}

/** `/a/very/long/…/path/end`: keeps both ends of a long path. */
export function middleTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const keep = maxChars - 1;
  const head = Math.ceil(keep / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}
