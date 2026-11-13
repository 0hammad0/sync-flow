import type { BreakdownRow, PageRow, SessionRowDto } from '@/server/analytics/dto';
import { csvOneDecimal, csvPercent, csvSeconds, csvTime, type CsvColumn } from './csv';

// The only fields an export can write (allowlist, 08-tables.md). Each table
// reads the same DTO the screen shows, so a role sees nothing in a file it
// cannot see on screen. Sessions rows arrive already masked per role
// (`maskIpDto`): there is no column that reads a raw session doc.

export const SESSION_COLUMNS: readonly CsvColumn<SessionRowDto>[] = [
  { header: 'Started (UTC)', value: (r) => csvTime(r.startedAt) },
  { header: 'Last seen (UTC)', value: (r) => csvTime(r.lastSeenAt) },
  { header: 'Duration (s)', value: (r) => csvSeconds(r.durationMs) },
  { header: 'Engaged time (s)', value: (r) => csvSeconds(r.engagedMs) },
  { header: 'Pages', value: (r) => r.pageviews },
  { header: 'Entry page', value: (r) => r.entryPath },
  { header: 'Exit page', value: (r) => r.exitPath },
  { header: 'Country', value: (r) => r.country },
  { header: 'Region', value: (r) => r.region },
  { header: 'City', value: (r) => r.city },
  { header: 'Device', value: (r) => r.device },
  { header: 'Browser', value: (r) => r.browser },
  { header: 'OS', value: (r) => r.os },
  { header: 'Referrer', value: (r) => r.referrerHost },
  { header: 'UTM source', value: (r) => r.utmSource },
  { header: 'User ID', value: (r) => r.userId },
  { header: 'IP', value: (r) => r.ip },
  { header: 'IP masked', value: (r) => (r.ipMasked ? 'yes' : 'no') },
  { header: 'Sampled', value: (r) => (r.sampled ? 'yes' : 'no') },
  { header: 'Session ID', value: (r) => r.id },
];

export const PAGE_COLUMNS: readonly CsvColumn<PageRow>[] = [
  { header: 'Path', value: (r) => (r.other ? r.label : r.path) },
  { header: 'Views', value: (r) => r.pageviews },
  { header: 'Visitors', value: (r) => r.visitors },
  { header: 'Sessions', value: (r) => r.sessions },
  { header: 'Entries', value: (r) => r.entries },
  { header: 'Exits', value: (r) => r.exits },
  { header: 'Avg time (s)', value: (r) => csvSeconds(r.avgEngagedMs) },
  { header: 'Bounce rate (%)', value: (r) => csvPercent(r.bounceRate) },
  { header: 'Exit rate (%)', value: (r) => csvPercent(r.exitRate) },
  { header: 'Avg scroll (%)', value: (r) => csvOneDecimal(r.avgScroll) },
  { header: 'Share of views (%)', value: (r) => csvPercent(r.share) },
];

/** Shared by places (country / region / city) and sources. `name` heads the label column. */
function breakdownColumns(name: string, extra: readonly CsvColumn<BreakdownRow>[] = []): readonly CsvColumn<BreakdownRow>[] {
  return [
    { header: name, value: (r) => r.label },
    { header: 'Code', value: (r) => (r.other ? null : r.key) },
    ...extra,
    { header: 'Visitors', value: (r) => r.visitors },
    { header: 'Sessions', value: (r) => r.sessions },
    { header: 'Page views', value: (r) => r.pageviews },
    { header: 'Avg time (s)', value: (r) => csvSeconds(r.avgEngagedMs) },
    { header: 'Bounce rate (%)', value: (r) => csvPercent(r.bounceRate) },
    { header: 'Share of sessions (%)', value: (r) => csvPercent(r.share) },
  ];
}

export const COUNTRY_COLUMNS = breakdownColumns('Country');
export const REGION_COLUMNS = breakdownColumns('Region', [{ header: 'Country code', value: (r) => r.country }]);
export const CITY_COLUMNS = breakdownColumns('City', [
  { header: 'Country code', value: (r) => r.country },
  { header: 'Region code', value: (r) => r.region },
]);

export type SourceDimension = 'referrer' | 'utm_source' | 'utm_medium' | 'utm_campaign' | 'device' | 'browser' | 'os';

const SOURCE_NAMES: Record<SourceDimension, string> = {
  referrer: 'Referrer',
  utm_source: 'UTM source',
  utm_medium: 'UTM medium',
  utm_campaign: 'UTM campaign',
  device: 'Device',
  browser: 'Browser',
  os: 'OS',
};

export function sourceColumns(dim: SourceDimension): readonly CsvColumn<BreakdownRow>[] {
  return breakdownColumns(SOURCE_NAMES[dim]);
}
