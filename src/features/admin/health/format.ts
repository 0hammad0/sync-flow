// Formatting for Health. Always UTC, so server and client render the same text.

const UTC = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `13 Nov, 03:00 UTC`. */
export function formatUtc(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${UTC.format(d)} UTC`;
}

/** `850 ms`, `12.4 s`, `3 min 5 s`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** `5 h ago`, `2 d ago`. Coarse on purpose: the page is cached for 60 s. */
export function formatAge(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))} min ago`;
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
