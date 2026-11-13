import { z } from 'zod';
import { AUDIT_ACTION_LIST } from './catalog';

// URL params of /admin/audit: `?range&actor&action&q&cursor&id`.
// Unknown values fall back to the defaults (an unknown `?action=` is ignored,
// 11-audit-log.md "Validation"). Read only: there is no audit write input.

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

/** A uid (Firebase uids are ≤ 128 chars of letters, digits, a few symbols). */
const actorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export const auditParamsSchema = z.object({
  range: z.enum(AUDIT_RANGES).catch('30d'),
  actor: actorSchema.optional().catch(undefined),
  action: z.enum(AUDIT_ACTION_LIST).optional().catch(undefined),
  /** Exact target id (an IP, uid, file id, room code, batch id). No prefix search. */
  q: z.string().trim().min(1).max(200).optional().catch(undefined),
  cursor: z.string().max(400).optional().catch(undefined),
});
export type AuditParams = z.infer<typeof auditParamsSchema>;
