// Date ranges of the audit log. Zod-free: the client table imports it.

export const AUDIT_RANGES = ['24h', '7d', '30d', '90d', '1y', '2y'] as const;
export type AuditRange = (typeof AUDIT_RANGES)[number];

export const AUDIT_RANGE_LABELS: Record<AuditRange, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '1y': 'Last year',
  '2y': 'Last 2 years',
};

const DAY_MS = 24 * 60 * 60_000;
export const AUDIT_RANGE_MS: Record<AuditRange, number> = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
  '90d': 90 * DAY_MS,
  '1y': 365 * DAY_MS,
  // Retention: entries are kept for 2 years.
  '2y': 730 * DAY_MS,
};
