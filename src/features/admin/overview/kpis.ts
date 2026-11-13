import { rangeToParams, type ResolvedRange } from '@/features/admin/analytics/range';
import type { Kpis, KpisDto } from '@/features/admin/analytics/types';
import { formatChange, formatDuration } from '@/shared/ui/charts/format';

// KPI maths and wording for the Overview cards (02-overview.md "Interactions").
// Pure: safe on the server and in tests.

export type KpiKey = keyof Kpis;
type KpiKind = 'count' | 'duration' | 'rate';

type KpiDef = {
  key: KpiKey;
  label: string;
  kind: KpiKind;
  /** Bounce rate: down is good. */
  higherIsBetter: boolean;
  /** Singular / plural noun for counts ("1 visitor"). */
  unit?: readonly [string, string];
  /** The screen with the detail. */
  path: string;
  hint?: string;
};

export const KPI_DEFS: readonly KpiDef[] = [
  {
    key: 'visitors',
    label: 'Visitors',
    kind: 'count',
    higherIsBetter: true,
    unit: ['visitor', 'visitors'],
    path: '/admin/sessions',
    hint: 'Counted per browser tab session.',
  },
  { key: 'sessions', label: 'Sessions', kind: 'count', higherIsBetter: true, unit: ['session', 'sessions'], path: '/admin/sessions' },
  { key: 'pageviews', label: 'Page views', kind: 'count', higherIsBetter: true, unit: ['page view', 'page views'], path: '/admin/pages' },
  { key: 'avgEngagedMs', label: 'Avg time', kind: 'duration', higherIsBetter: true, path: '/admin/pages' },
  { key: 'bounceRate', label: 'Bounce rate', kind: 'rate', higherIsBetter: false, path: '/admin/pages' },
];

/** Counts shown in full up to this; above it `12.4M` (11-copy.md). */
export const FULL_COUNT_MAX = 9_999_999;

const COUNT = new Intl.NumberFormat('en-US');
const ONE_DECIMAL = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatKpiCount(n: number): string {
  if (n > FULL_COUNT_MAX) return `${ONE_DECIMAL.format(n / 1_000_000)}M`;
  return COUNT.format(n);
}

/** Card value: `1,284` · `2m 41s` · `38.2%`, or `—` when there is nothing to divide by. */
export function formatKpiValue(kind: KpiKind, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (kind === 'duration') return formatDuration(value / 1000);
  if (kind === 'rate') return `${ONE_DECIMAL.format(value * 100)}%`;
  return formatKpiCount(value);
}

/** Exact value for tooltips (never compact). */
function formatExact(kind: KpiKind, value: number | null): string {
  if (kind === 'count' && value !== null) return COUNT.format(value);
  return formatKpiValue(kind, value);
}

export type KpiChange = {
  /** `+12.4%`, `−9s`, `+1.3 pt`, `0%`. Real minus sign. */
  text: string;
  sign: 1 | 0 | -1;
  /** null when there is no change. */
  good: boolean | null;
  /** Words for screen readers: "up 12.4%". */
  spoken: string;
};

/**
 * Change vs the previous period. Counts: percent. Avg time: the difference as a
 * duration. Bounce rate: percentage points. null when the previous period has
 * nothing to compare with (the card shows "—").
 */
export function kpiChange(def: Pick<KpiDef, 'kind' | 'higherIsBetter'>, current: number | null, previous: number | null): KpiChange | null {
  if (current === null || previous === null) return null;
  let text: string;
  let sign: 1 | 0 | -1;
  let magnitude: string;
  if (def.kind === 'count') {
    const change = formatChange(current, previous);
    if (!change) return null;
    ({ text, sign } = change);
    magnitude = text.replace(/^[+−]/, '');
  } else if (def.kind === 'duration') {
    const seconds = Math.round((current - previous) / 1000);
    sign = seconds > 0 ? 1 : seconds < 0 ? -1 : 0;
    magnitude = formatDuration(Math.abs(seconds));
    text = sign === 0 ? magnitude : `${sign > 0 ? '+' : '−'}${magnitude}`;
  } else {
    const points = Math.round((current - previous) * 1000) / 10;
    sign = points > 0 ? 1 : points < 0 ? -1 : 0;
    magnitude = `${ONE_DECIMAL.format(Math.abs(points))} pt`;
    text = sign === 0 ? '0 pt' : `${sign > 0 ? '+' : '−'}${magnitude}`;
  }
  const good = sign === 0 ? null : sign > 0 === def.higherIsBetter;
  const spoken = sign === 0 ? 'no change' : `${sign > 0 ? 'up' : 'down'} ${magnitude}`;
  return { text, sign, good, spoken };
}

/** "previous 7 days" · "same hours yesterday" · "previous 24 hours". */
export function previousLabel(range: Pick<ResolvedRange, 'kind' | 'days'>): string {
  if (range.kind === 'today') return 'same hours yesterday';
  if (range.kind === '24h') return 'previous 24 hours';
  return range.days === 1 ? 'previous day' : `previous ${range.days} days`;
}

/** `?range=30d` (or the custom days) to carry the range to another screen. */
export function rangeQuery(range: Pick<ResolvedRange, 'kind' | 'from' | 'to'>, extra: Record<string, string> = {}): string {
  return `?${new URLSearchParams({ ...extra, ...rangeToParams(range) }).toString()}`;
}

export type KpiCardModel = {
  key: KpiKey;
  label: string;
  value: string;
  change: KpiChange | null;
  href: string;
  /** Full accessible name: "Visitors 1,284, up 12.4% vs previous 7 days". */
  ariaLabel: string;
  /** "1,284 visitors · previous 7 days: 1,142". */
  tooltip: string;
  hint?: string;
};

function noun(def: KpiDef, n: number | null): string {
  if (!def.unit) return def.label.toLowerCase();
  return n === 1 ? def.unit[0] : def.unit[1];
}

export function buildKpiCards(dto: KpisDto, range: ResolvedRange): KpiCardModel[] {
  const prevLabel = previousLabel(range);
  const query = rangeQuery(range);
  return KPI_DEFS.map((def) => {
    const current = dto.current[def.key];
    const previous = dto.previous[def.key];
    const value = formatKpiValue(def.kind, current);
    const change = kpiChange(def, current, previous);
    const exact = formatExact(def.kind, current);
    const prevExact = formatExact(def.kind, previous);
    const head = def.unit ? `${exact} ${noun(def, current)}` : `${def.label} ${exact}`;
    const tooltip = change ? `${head} · ${prevLabel}: ${prevExact}` : `${head} · No data in the ${prevLabel}.`;
    const ariaLabel = change
      ? `${def.label} ${value}, ${change.spoken} vs ${prevLabel}`
      : `${def.label} ${value}, no data in the ${prevLabel}`;
    return { key: def.key, label: def.label, value, change, href: `${def.path}${query}`, ariaLabel, tooltip, hint: def.hint };
  });
}

/** True when the range holds at least one session (else the KPI row shows its empty state). */
export function hasVisits(kpis: Kpis): boolean {
  return kpis.sessions > 0 || kpis.pageviews > 0;
}
