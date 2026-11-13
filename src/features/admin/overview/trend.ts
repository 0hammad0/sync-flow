import { RANGE_LABELS, formatDay, formatDaySpan, type ResolvedRange } from '@/features/admin/analytics/range';
import type { TrendDto } from '@/features/admin/analytics/types';
import type { LinePoint } from '@/shared/ui/charts/LineChart';
import { formatChange } from '@/shared/ui/charts/format';
import { previousLabel } from './kpis';

// TrendDto → LineChart props (02-overview.md "Trend"). Pure.

const COUNT = new Intl.NumberFormat('en-US');

export function trendPoints(dto: TrendDto): LinePoint[] {
  return dto.points.map((p) => ({
    t: Date.parse(p.start),
    value: p.visitors,
    compare: p.prevKey === null ? null : p.prevVisitors,
  }));
}

/** "last 7 days" · "today" · "12 Nov – 18 Nov 2026". */
export function rangePhrase(range: Pick<ResolvedRange, 'kind' | 'from' | 'to'>): string {
  if (range.kind === 'custom') return formatDaySpan(range.from, range.to);
  return RANGE_LABELS[range.kind].toLowerCase();
}

/**
 * Screen-reader sentence for the chart: "Visitors, last 7 days: 1,204 total,
 * up 12.4% from the previous 7 days. Peak 312 on 11 Nov."
 */
export function trendSummary(dto: TrendDto, range: ResolvedRange): string {
  const total = dto.points.reduce((s, p) => s + p.visitors, 0);
  const prevTotal = dto.points.reduce((s, p) => s + p.prevVisitors, 0);
  let text = `Visitors, ${rangePhrase(range)}: ${COUNT.format(total)} total`;
  const change = formatChange(total, prevTotal);
  if (change) {
    const word = change.sign === 0 ? 'no change' : `${change.sign > 0 ? 'up' : 'down'} ${change.text.replace(/^[+−]/, '')}`;
    text += `, ${word} from the ${previousLabel(range)}`;
  }
  text += '.';
  const peak = dto.points.reduce<TrendDto['points'][number] | null>((best, p) => (best === null || p.visitors > best.visitors ? p : best), null);
  if (peak && peak.visitors > 0) {
    const when = dto.granularity === 'hour' ? `${peak.start.slice(11, 16)} UTC` : formatDay(peak.key, false);
    text += ` Peak ${COUNT.format(peak.visitors)} ${dto.granularity === 'hour' ? 'at' : 'on'} ${when}.`;
  }
  return text;
}

/**
 * First day with data when the range starts before any rollup exists (tracking
 * started inside the range). Lets the chart say "No data before 13 Nov" instead
 * of looking broken. null when the range has data from its first day, or none.
 */
export function dataStartDay(dto: TrendDto): string | null {
  if (dto.granularity !== 'day') return null;
  const first = dto.points.findIndex((p) => !p.missing);
  if (first <= 0) return null;
  return dto.points[first].key;
}
