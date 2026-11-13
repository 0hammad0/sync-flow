import type { LiveDto, LiveSessionDto } from '@/features/admin/analytics/types';
import type { MapDatum } from '@/shared/ui/map/WorldMap';

// Display helpers for Live (03-live.md). Pure.

const COUNT = new Intl.NumberFormat('en-US');
const TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/** `14:02:31` (UTC). */
export function formatClock(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? TIME.format(t) : '—';
}

/** `PK · Lahore`, `PK`, or `Unknown`. */
export function locationLabel(country: string | null, city: string | null): string {
  if (!country) return 'Unknown';
  return city ? `${country} · ${city}` : country;
}

export function deviceLabel(device: string | null): string {
  return device ?? 'Unknown';
}

/** First 4 hex of a session id: `7f3a…`. */
export function shortId(id: string): string {
  return id.length > 4 ? `${id.slice(0, 4)}…` : id;
}

/** IPv6 shortened in the middle (`2001:db8:…:7334`); the full value goes in a title. */
export function shortIp(ip: string | null): string {
  if (!ip) return '—';
  if (!ip.includes(':') || ip.length <= 20) return ip;
  const parts = ip.split(':');
  return `${parts.slice(0, 2).join(':')}:…:${parts[parts.length - 1]}`;
}

/** "7 desktop · 4 mobile · 1 tablet" (zero parts left out). */
export function deviceSplit(byDevice: LiveDto['byDevice']): string {
  const order = ['desktop', 'mobile', 'tablet', 'unknown'] as const;
  return order
    .filter((d) => byDevice[d] > 0)
    .map((d) => `${COUNT.format(byDevice[d])} ${d}`)
    .join(' · ');
}

/** Online visitors per country for the map (active sessions only). */
export function liveMapData(sessions: readonly LiveSessionDto[]): MapDatum[] {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    if (!s.active || !s.country) continue;
    counts.set(s.country, (counts.get(s.country) ?? 0) + 1);
  }
  return [...counts.entries()].map(([country, value]) => ({ country, value }));
}

/** "12 people online in 5 countries." */
export function liveMapSummary(data: readonly MapDatum[]): string {
  const people = data.reduce((s, d) => s + d.value, 0);
  const noun = people === 1 ? 'person' : 'people';
  const places = data.length === 1 ? 'country' : 'countries';
  return `${COUNT.format(people)} ${noun} online in ${COUNT.format(data.length)} ${places}.`;
}

/** Time on the site: to the poll time while active, else to the last heartbeat. Not ticking. */
export function timeOnSiteMs(session: Pick<LiveSessionDto, 'startedAt' | 'lastSeenAt' | 'active'>, at: string): number | null {
  if (!session.startedAt) return null;
  const end = session.active ? Date.parse(at) : Date.parse(session.lastSeenAt);
  const ms = end - Date.parse(session.startedAt);
  return Number.isFinite(ms) ? Math.max(0, ms) : null;
}

/** Online window (90 s) + one Live poll (30 s): a visitor who left stays one poll, dimmed. */
export const LEFT_VISIBLE_MS = 120_000;

/**
 * Rows for the visitors list: everyone active, plus those who left within the
 * last poll (shown at 50%). Active first, then most recently seen.
 */
export function visibleLiveSessions(sessions: readonly LiveSessionDto[], at: string): LiveSessionDto[] {
  const since = Date.parse(at) - LEFT_VISIBLE_MS;
  return sessions
    .filter((s) => s.active || Date.parse(s.lastSeenAt) > since)
    .sort((a, b) => Number(b.active) - Number(a.active) || b.lastSeenAt.localeCompare(a.lastSeenAt));
}

/** Count text for the summary and its live region: "12 online". */
export function onlineText(online: number): string {
  return `${COUNT.format(online)} online`;
}
