import type { AuditActionName } from './catalog';
import type { AuditData } from './diff';

/** One audit row as the client sees it. Dates are ISO strings. Never edited or deleted. */
export type AuditRowDto = {
  id: string;
  at: string;
  actorUid: string | null;
  actorEmail: string | null;
  actorRole: 'owner' | 'moderator' | 'viewer' | null;
  action: AuditActionName;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  /** Sanitised at write time (deny-list, 8 KB cap); file names dropped again on read [D-6]. */
  before: AuditData;
  after: AuditData;
};
