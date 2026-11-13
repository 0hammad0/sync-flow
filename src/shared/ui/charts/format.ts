// Number and date formats shared by the chart kit (09-charts-and-maps.md,
// 11-copy.md). Pure functions: safe in Server and Client Components.

/** How a value reads. `percent` takes 0–100 (not 0–1); `duration` takes seconds. */
export type ValueFormat = 'count' | 'duration' | 'percent';

/** Time bucket of a series point. Picks the axis tick and tooltip date format. */
export type Bucket = 'hour' | 'day' | 'week';

const COUNT = new Intl.NumberFormat('en-US');
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const PERCENT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** Exact value with its unit: `1,204` · `1m 23s` · `23.4%`. */
export function formatValue(value: number, format: ValueFormat = 'count'): string {
  if (format === 'percent') return `${PERCENT.format(value)}%`;
  if (format === 'duration') return formatDuration(value);
  return COUNT.format(value);
}

/** Axis tick: compact (`1.2k`, `3m`). Durations and percents stay short already. */
export function formatTick(value: number, format: ValueFormat = 'count'): string {
  if (format === 'count') return COMPACT.format(value).toLowerCase();
  return formatValue(value, format);
}

/** `45s` · `1m 23s` · `1h 02m`. Seconds are rounded. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Share of a total as `23.4%`; `<0.1%` for a tiny non-zero share. */
export function formatShare(value: number, total: number): string {
  if (total <= 0 || value <= 0) return '0%';
  const pct = (value / total) * 100;
  return pct < 0.1 ? '<0.1%' : `${PERCENT.format(pct)}%`;
}

/** Signed change between two values: `+12.4%`, `−3%`, or null when there is no base. */
export function formatChange(value: number, previous: number): { text: string; sign: 1 | 0 | -1 } | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  const pct = ((value - previous) / previous) * 100;
  const rounded = Math.round(pct * 10) / 10;
  if (rounded === 0) return { text: '0%', sign: 0 };
  return { text: `${rounded > 0 ? '+' : '−'}${PERCENT.format(Math.abs(rounded))}%`, sign: rounded > 0 ? 1 : -1 };
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dtf(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, ...options });
    fmtCache.set(key, f);
  }
  return f;
}

/** Axis tick for a bucket start: `14:00` (hour) or `13 Nov` (day, week). */
export function formatBucketTick(t: number, bucket: Bucket, timeZone = 'UTC'): string {
  if (bucket === 'hour') return dtf(timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
  return dtf(timeZone, { day: 'numeric', month: 'short' }).format(t);
}

/** Full date for a tooltip or table row: `Thu 13 Nov, 14:00–15:00` · `Thu 13 Nov 2026` · `Week of 10 Nov 2026`. */
export function formatBucketLabel(t: number, bucket: Bucket, timeZone = 'UTC'): string {
  const date = (opts: Intl.DateTimeFormatOptions) => dtf(timeZone, opts).format(t).replace(',', '');
  if (bucket === 'hour') {
    const hour = dtf(timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const day = date({ weekday: 'short', day: 'numeric', month: 'short' });
    return `${day}, ${hour.format(t)}–${hour.format(t + 3_600_000)}`;
  }
  const full = date({ weekday: bucket === 'day' ? 'short' : undefined, day: 'numeric', month: 'short', year: 'numeric' });
  return bucket === 'week' ? `Week of ${full}` : full;
}
