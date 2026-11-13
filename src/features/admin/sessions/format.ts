import type { TimelinePageDto } from '@/server/analytics/dto';

// Display helpers for the Sessions table and detail (04-sessions.md "Data").
// Pure, client and server. Always UTC, so server and client render the same.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');

function parse(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `4m 12s`, `0m 04s`, `1h 03m`. */
export function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)}h ${pad(Math.floor((ms % HOUR) / MINUTE))}m`;
  return `${Math.floor(ms / MINUTE)}m ${pad(Math.floor((ms % MINUTE) / SECOND))}s`;
}

/** Screen-reader text: `4 minutes 12 seconds`, `1 hour 3 minutes`. */
export function durationLabel(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return 'Unknown';
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (ms >= HOUR) return `${unit(Math.floor(ms / HOUR), 'hour')} ${unit(Math.floor((ms % HOUR) / MINUTE), 'minute')}`;
  return `${unit(Math.floor(ms / MINUTE), 'minute')} ${unit(Math.floor((ms % MINUTE) / SECOND), 'second')}`;
}

/** `14:02:31` (UTC). */
export function formatClock(iso: string | null): string {
  const d = parse(iso);
  return d ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` : '—';
}

/** Table "Started": `14:02:31` today (UTC), else `13 Nov 14:02`. `today` is `YYYY-MM-DD`. */
export function formatStarted(iso: string | null, today: string): string {
  const d = parse(iso);
  if (!d) return '—';
  if (d.toISOString().slice(0, 10) === today) return formatClock(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Full time for tooltips: `2026-11-13 14:02:31 UTC`. */
export function formatFullUtc(iso: string | null): string {
  const d = parse(iso);
  return d ? `${d.toISOString().slice(0, 10)} ${formatClock(iso)} UTC` : '—';
}

/** Offset from the session start: `+0:47`, `+12:05`, `+1:02:10`. */
export function formatOffset(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  const total = Math.floor(ms / SECOND);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `+${h}:${pad(m)}:${pad(s)}` : `+${m}:${pad(s)}`;
}

/** `/` → `/chat/[code]`, or one path when entry and exit match. */
export function formatPaths(entry: string | null, exit: string | null): string {
  if (!entry && !exit) return '—';
  if (!entry || !exit || entry === exit) return (entry ?? exit)!;
  return `${entry} → ${exit}`;
}

/** `PK Lahore`, `US`, or `—`. ISO code + city, no flags. */
export function formatPlace(row: { country: string | null; city: string | null }): string {
  return [row.country, row.city].filter(Boolean).join(' ') || '—';
}

const DEVICE_TEXT = { mobile: 'Mobile', tablet: 'Tablet', desktop: 'Desktop' } as const;

/** `Mobile · Safari`. */
export function formatDevice(row: { device: keyof typeof DEVICE_TEXT | null; browser: string | null }): string {
  return [row.device ? DEVICE_TEXT[row.device] : null, row.browser].filter(Boolean).join(' · ') || '—';
}

/** Referrer host, else utm_source, else `direct`. */
export function formatSource(row: { referrerHost: string | null; utmSource: string | null }): string {
  return row.referrerHost || row.utmSource || 'direct';
}

export type TimelineItem = TimelinePageDto & {
  /** ms from the session start; null without a ts. */
  offsetMs: number | null;
};

/**
 * Page views oldest first (ts, then id), views without a time last. The DTO
 * already sorts, but the timeline must never show them out of order.
 */
export function timelineItems(pages: readonly TimelinePageDto[], startedAt: string | null): TimelineItem[] {
  const start = parse(startedAt)?.getTime() ?? null;
  const time = (p: TimelinePageDto) => parse(p.ts)?.getTime() ?? null;
  return [...pages]
    .sort((a, b) => {
      const ta = time(a);
      const tb = time(b);
      if (ta === null || tb === null) return ta === tb ? (a.id < b.id ? -1 : 1) : ta === null ? 1 : -1;
      return ta - tb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    })
    .map((p) => {
      const at = time(p);
      return { ...p, offsetMs: at !== null && start !== null ? Math.max(0, at - start) : null };
    });
}

/** CIDR to block when only the truncated IP is left: `/24` for IPv4, `/48` for IPv6. */
export function truncatedCidr(ipTrunc: string): string {
  return `${ipTrunc}/${ipTrunc.includes(':') ? 48 : 24}`;
}

/** What "Block this IP" pre-fills, or null when the role sees a masked IP (or none is held). */
export function blockTargetFor(row: { ip: string | null; ipMasked: boolean; ipTruncated: boolean }): {
  type: 'ip' | 'cidr';
  value: string;
} | null {
  if (!row.ip || row.ipMasked) return null;
  return row.ipTruncated ? { type: 'cidr', value: truncatedCidr(row.ip) } : { type: 'ip', value: row.ip };
}
