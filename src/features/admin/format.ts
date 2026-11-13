// Pure display helpers shared by admin screens (rooms, users). Client and server.
// Always UTC, so server and client render the same text.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** `0 B`, `512 B`, `12.4 KB`, `3.1 MB`, `1.2 GB` (1 KB = 1,024 B). `—` when unknown. */
export function formatBytes(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** `1,204`, or `—` when unknown. */
export function formatNumber(n: number | null): string {
  return n == null ? '—' : n.toLocaleString('en-US');
}

/** Countdown: `in 5h 12m`, `in 0h 08m`, or `Expired`. */
export function formatCountdown(expiresAt: string, nowMs: number): string {
  const diff = new Date(expiresAt).getTime() - nowMs;
  if (!(diff > 0)) return 'Expired';
  const h = Math.floor(diff / HOUR);
  const m = Math.floor((diff % HOUR) / MINUTE);
  return `in ${h}h ${String(m).padStart(2, '0')}m`;
}

/** `expired` past expiry, `soon` under an hour, else `ok`. Drives the colour. */
export function expiryTone(expiresAt: string, nowMs: number): 'expired' | 'soon' | 'ok' {
  const diff = new Date(expiresAt).getTime() - nowMs;
  if (!(diff > 0)) return 'expired';
  return diff < HOUR ? 'soon' : 'ok';
}

/** `1 h`, `24 h`, `7 d`. */
export function formatTtl(hours: number): string {
  return hours >= 48 && hours % 24 === 0 ? `${hours / 24} d` : `${hours} h`;
}

const UTC = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const UTC_DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

/** `13 Nov 2026, 09:02 UTC`, or `—`. */
export function formatUtc(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${UTC.format(d)} UTC`;
}

/** `2 Sep 2026`, or `—`. */
export function formatDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : UTC_DAY.format(d);
}

/** `5 min ago`, `2 h ago`, `5 d ago`, or `—`. */
export function formatAgo(iso: string | null, nowMs: number): string {
  if (!iso) return '—';
  const diff = nowMs - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '—';
  if (diff < HOUR) return `${Math.max(1, Math.floor(diff / MINUTE))} min ago`;
  if (diff < 48 * HOUR) return `${Math.floor(diff / HOUR)} h ago`;
  return `${Math.floor(diff / (24 * HOUR))} d ago`;
}
