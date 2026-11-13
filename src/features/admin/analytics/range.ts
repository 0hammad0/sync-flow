// Date ranges of the analytics screens (02-overview.md "Range handling").
// Pure and zod-free: the top-bar picker (client) and the server queries both
// import it. Days are UTC calendar days (`a_daily` / `a_hourly` ids are UTC),
// and `from` / `to` are inclusive.

export const RANGE_PRESETS = ['today', '24h', '7d', '30d', '90d'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const RANGE_KINDS = [...RANGE_PRESETS, 'custom'] as const;
export type RangeKind = RangePreset | 'custom';

export const DEFAULT_RANGE: RangePreset = '7d';
/** Longest custom range (02-overview.md "custom span > 365 days"). */
export const MAX_SPAN_DAYS = 365;

export const RANGE_LABELS: Record<RangeKind, string> = {
  today: 'Today',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  custom: 'Custom range',
};

/** Compact trigger text for phones. */
export const RANGE_SHORT_LABELS: Record<RangeKind, string> = {
  today: 'Today',
  '24h': '24h',
  '7d': '7d',
  '30d': '30d',
  '90d': '90d',
  custom: 'Custom',
};

/** Raw URL state: `?range=7d` or `?range=custom&from=…&to=…`. Anything unusable is null. */
export type RangeParams = { range: RangeKind | null; from: string | null; to: string | null };

export type RangeGranularity = 'day' | 'hour';

/** A range turned into concrete UTC days. */
export type ResolvedRange = {
  kind: RangeKind;
  /** First UTC day, `YYYY-MM-DD`, inclusive. */
  from: string;
  /** Last UTC day, inclusive. Never after today. */
  to: string;
  /** Calendar days from `from` to `to`. */
  days: number;
  /** `hour` for today and 24h (timeseries per hour), else `day`. */
  granularity: RangeGranularity;
  /** True when the asked range was cut (retention window, max span, future days). */
  clamped: boolean;
};

export type RangeOptions = {
  /** Today's UTC day (`dayKey(new Date())`). Passed in so this stays pure. */
  today: string;
  /**
   * Days of data kept, counted back from today (inclusive). Screens that read
   * raw `a_sessions` pass `rawRetentionDays`; rollup screens leave it unset
   * (`a_daily` is kept forever).
   */
  retentionDays?: number | null;
  /** Default `MAX_SPAN_DAYS`. */
  maxSpanDays?: number;
};

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` that is a real calendar day (rejects `2026-02-30`). */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export function isRangeKind(value: unknown): value is RangeKind {
  return typeof value === 'string' && (RANGE_KINDS as readonly string[]).includes(value);
}

export function isRangePreset(value: unknown): value is RangePreset {
  return typeof value === 'string' && (RANGE_PRESETS as readonly string[]).includes(value);
}

/** UTC day of an instant. */
export function utcDayOf(at: Date | number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** `day` plus `n` days (n may be negative). */
export function addDays(day: string, n: number): string {
  return utcDayOf(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS);
}

/** Days from `from` to `to`, both counted. 0 when `to` is before `from`. */
export function spanDays(from: string, to: string): number {
  const diff = Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS);
  return Math.max(0, diff + 1);
}

/** Every day from `from` to `to`, oldest first. */
export function daysBetween(from: string, to: string): string[] {
  const n = spanDays(from, to);
  return Array.from({ length: n }, (_, i) => addDays(from, i));
}

function presetRange(preset: RangePreset, today: string, earliest: string | null): ResolvedRange {
  const length = preset === 'today' ? 1 : preset === '24h' ? 2 : Number.parseInt(preset, 10);
  let from = addDays(today, -(length - 1));
  let clamped = false;
  if (earliest && from < earliest) {
    from = earliest;
    clamped = true;
  }
  return {
    kind: preset,
    from,
    to: today,
    days: spanDays(from, today),
    granularity: preset === 'today' || preset === '24h' ? 'hour' : 'day',
    clamped,
  };
}

/**
 * The concrete range for URL params. Rules (02-overview.md):
 * - unknown or missing `range`, or a custom range with bad dates → `7d`, no error
 * - `from` / `to` without `range` mean custom
 * - custom `from > to` is swapped; days after today are cut to today
 * - `from` before the retention window starts at the window; the span is cut
 *   to `maxSpanDays`, keeping `to`
 */
export function resolveRange(params: RangeParams, options: RangeOptions): ResolvedRange {
  const { today } = options;
  const retention = options.retentionDays && options.retentionDays > 0 ? Math.floor(options.retentionDays) : null;
  const earliest = retention ? addDays(today, -(retention - 1)) : null;
  const maxSpan = Math.max(1, Math.min(options.maxSpanDays ?? MAX_SPAN_DAYS, retention ?? Number.POSITIVE_INFINITY));
  const fallback = () => presetRange(DEFAULT_RANGE, today, earliest);

  const kind = params.range ?? (params.from && params.to ? 'custom' : null);
  if (kind === null) return fallback();
  if (kind !== 'custom') return presetRange(kind, today, earliest);

  const { from, to } = params;
  if (!isIsoDay(from) || !isIsoDay(to)) return fallback();
  let [start, end] = from <= to ? [from, to] : [to, from];
  let clamped = false;
  if (start > today) return fallback();
  if (end > today) {
    end = today;
    clamped = true;
  }
  if (earliest && end < earliest) return fallback();
  if (earliest && start < earliest) {
    start = earliest;
    clamped = true;
  }
  if (spanDays(start, end) > maxSpan) {
    start = addDays(end, -(maxSpan - 1));
    clamped = true;
  }
  return { kind: 'custom', from: start, to: end, days: spanDays(start, end), granularity: 'day', clamped };
}

/** URL params that reproduce a range (for links between screens). */
export function rangeToParams(range: Pick<ResolvedRange, 'kind' | 'from' | 'to'>): Record<string, string> {
  return range.kind === 'custom' ? { range: 'custom', from: range.from, to: range.to } : { range: range.kind };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `12 Nov 2026`, from the day string itself (no time zone involved). */
export function formatDay(day: string, withYear = true): string {
  const [y, m, d] = day.split('-');
  const text = `${Number(d)} ${MONTHS[Number(m) - 1] ?? m}`;
  return withYear ? `${text} ${y}` : text;
}

/** `12 Nov – 18 Nov 2026` (year once when both days share it). */
export function formatDaySpan(from: string, to: string): string {
  if (from === to) return formatDay(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${formatDay(from, !sameYear)} – ${formatDay(to)}`;
}
