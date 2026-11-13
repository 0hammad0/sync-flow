// Audit action catalogue for the filter list and labels (11-audit-log.md
// "Action catalogue"). Client-safe copy of AUDIT_ACTIONS in
// src/server/repositories/interfaces.ts; a unit test keeps the two equal.

export const AUDIT_ACTION_LIST = [
  'auth.sign_in',
  'auth.sign_out',
  'auth.denied',
  'auth.step_up',
  'block.create',
  'block.update',
  'block.remove',
  'block.restore',
  'file.delete',
  'storage.orphan_scan',
  'room.close',
  'user.disable',
  'user.enable',
  'user.revoke_sessions',
  'role.set',
  'settings.update',
  'analytics.delete',
  'export.csv',
] as const;

export type AuditActionName = (typeof AUDIT_ACTION_LIST)[number];

export const AUDIT_ACTION_LABELS: Record<AuditActionName, string> = {
  'auth.sign_in': 'Signed in',
  'auth.sign_out': 'Signed out',
  'auth.denied': 'Access denied',
  'auth.step_up': 'Confirmed identity',
  'block.create': 'Blocked',
  'block.update': 'Block changed',
  'block.remove': 'Unblocked',
  'block.restore': 'Block restored',
  'file.delete': 'Deleted file',
  'storage.orphan_scan': 'Scanned for orphans',
  'room.close': 'Closed room',
  'user.disable': 'Disabled user',
  'user.enable': 'Enabled user',
  'user.revoke_sessions': 'Signed user out',
  'role.set': 'Changed role',
  'settings.update': 'Changed settings',
  'analytics.delete': 'Deleted analytics',
  'export.csv': 'Exported CSV',
};

/** Pill colour group: danger for destructive actions and denials, neutral else. */
export function isDangerAction(action: AuditActionName): boolean {
  return action.endsWith('.delete') || action === 'room.close' || action === 'user.disable' || action === 'auth.denied';
}

export function isAuditAction(value: unknown): value is AuditActionName {
  return typeof value === 'string' && (AUDIT_ACTION_LIST as readonly string[]).includes(value);
}
