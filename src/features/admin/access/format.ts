// Pure display helpers for the access screen (client and server).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function span(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))} min`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} h`;
  return `${Math.round(ms / DAY)} d`;
}

/** "in 23 h", "Never", "2 d ago". */
export function formatExpiry(expiresAt: string | null, nowMs: number): string {
  if (!expiresAt) return 'Never';
  const diff = new Date(expiresAt).getTime() - nowMs;
  return diff > 0 ? `in ${span(diff)}` : `${span(-diff)} ago`;
}

/** "≈412", "≈3.1k". Hits are approximate by design. */
export function formatHits(hits: number): string {
  if (hits >= 1_000_000) return `≈${(hits / 1_000_000).toFixed(1)}M`;
  if (hits >= 10_000) return `≈${Math.round(hits / 1_000)}k`;
  if (hits >= 1_000) return `≈${(hits / 1_000).toFixed(1)}k`;
  return `≈${hits}`;
}

const UTC = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

/** "14 Nov 2026, 14:02 UTC". */
export function formatUtc(date: Date | string): string {
  return `${UTC.format(typeof date === 'string' ? new Date(date) : date)} UTC`;
}
