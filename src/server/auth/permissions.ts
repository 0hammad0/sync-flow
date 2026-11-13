import 'server-only';
import type { AdminRole } from '@/server/auth/types';

// Pure role → permission map. Source of truth:
// docs/admin/01-architecture/04-auth-and-security.md ("Roles and permissions").
// The UI may hide what a role cannot do, but the server check is this map.
//
// Scoping notes from that table (enforced in services, not here):
// - viewer without `ip:read` sees masked IPs (203.0.113.•••)
// - viewer `blocks:read` sees block values masked like IPs
// - moderator `audit:read` sees own actions only

export const ADMIN_ROLES = ['owner', 'moderator', 'viewer'] as const satisfies readonly AdminRole[];

export const PERMISSIONS = [
  'analytics:read',
  'ip:read',
  'files:read',
  'rooms:read',
  'users:read',
  'files:delete',
  'rooms:close',
  'blocks:read',
  'blocks:write',
  'users:disable',
  'users:revoke',
  'roles:write',
  'settings:write',
  'audit:read',
  'export:csv',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ_ALL: readonly Permission[] = [
  'analytics:read',
  'files:read',
  'rooms:read',
  'users:read',
  'blocks:read',
];

const MODERATE: readonly Permission[] = [
  'ip:read',
  'files:delete',
  'rooms:close',
  'blocks:write',
  'audit:read',
  'export:csv',
];

const OWNER_ONLY: readonly Permission[] = [
  'users:disable',
  'users:revoke',
  'roles:write',
  'settings:write',
];

const ROLE_PERMISSIONS: Readonly<Record<AdminRole, ReadonlySet<Permission>>> = {
  owner: new Set([...READ_ALL, ...MODERATE, ...OWNER_ONLY]),
  moderator: new Set([...READ_ALL, ...MODERATE]),
  viewer: new Set(READ_ALL),
};

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === 'string' && (ADMIN_ROLES as readonly string[]).includes(value);
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

/** True when `role` grants `permission`. Unknown or missing roles grant nothing. */
export function can(role: AdminRole | null | undefined, permission: Permission): boolean {
  if (!role || !isAdminRole(role)) return false;
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Every permission a role has, in table order. For DTOs that drive the UI. */
export function permissionsFor(role: AdminRole): Permission[] {
  return PERMISSIONS.filter((p) => ROLE_PERMISSIONS[role].has(p));
}
