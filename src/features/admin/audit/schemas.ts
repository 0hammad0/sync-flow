import { z } from 'zod';
import { AUDIT_ACTION_LIST } from './catalog';
import { AUDIT_RANGES } from './ranges';

// URL params of /admin/audit: `?range&actor&action&q&cursor&id`.
// Unknown values fall back to the defaults (an unknown `?action=` is ignored,
// 11-audit-log.md "Validation"). Read only: there is no audit write input.

export { AUDIT_RANGES, AUDIT_RANGE_LABELS, AUDIT_RANGE_MS, type AuditRange } from './ranges';

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
