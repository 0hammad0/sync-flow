// Audit display helpers. Times are stored and shown in UTC (11-audit-log.md "Edge cases").

const SHORT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

const LONG = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

/** `13 Nov, 14:02` or, long, `13 Nov 2026, 14:02:31 UTC`. */
export function formatAuditTime(iso: string, long = false): string {
  const date = new Date(iso);
  return long ? `${LONG.format(date)} UTC` : SHORT.format(date);
}

/** `9f1c2b3a…e7f8` for long ids (tooltip has the full value). */
export function middleTruncate(value: string, max = 24): string {
  if (value.length <= max) return value;
  const keep = Math.floor((max - 1) / 2);
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}
