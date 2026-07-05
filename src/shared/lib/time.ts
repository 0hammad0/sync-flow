/**
 * Format an ISO-8601 UTC timestamp for display in the **viewer's** local timezone.
 * Returns both a short display string (for inline use) and a full tooltip string.
 *
 * Note: `toLocaleString` with no `timeZone` option always uses the runtime's local
 * timezone — exactly what we want for "show me times in MY zone, not the sender's".
 */
export function formatChatTime(iso: string): { display: string; tooltip: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { display: '', tooltip: iso };
  }
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const display = sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });

  const tooltip = d.toLocaleString(undefined, {
    dateStyle: 'full',
    timeStyle: 'long',
  });

  return { display, tooltip };
}

/**
 * "in 4h 12m" / "in 6 days" — countdown from now to an ISO timestamp.
 * Negative diff returns "expired".
 */
export function formatTimeUntil(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return 'expired';
  const m = Math.floor(diffMs / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

/**
 * Read the viewer's IANA timezone (e.g. "Asia/Karachi"). Falls back to "UTC".
 * Safe to call in any environment — returns "UTC" SSR.
 */
export function clientTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
