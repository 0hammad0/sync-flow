import { describe, expect, it } from 'vitest';
import { ADMIN_ROLES, PERMISSIONS, can, isAdminRole, permissionsFor, type Permission } from '@/server/auth/permissions';
import type { AdminRole } from '@/server/auth/types';

// Copied by hand from docs/admin/01-architecture/04-auth-and-security.md
// ("Roles and permissions"). Change both together.
//                                  owner  moderator viewer
const TABLE: Record<Permission, [boolean, boolean, boolean]> = {
  'analytics:read': [true, true, true],
  'ip:read': [true, true, false],
  'files:read': [true, true, true],
  'rooms:read': [true, true, true],
  'users:read': [true, true, true],
  'files:delete': [true, true, false],
  'rooms:close': [true, true, false],
  'blocks:read': [true, true, true],
  'blocks:write': [true, true, false],
  'users:disable': [true, false, false],
  'users:revoke': [true, false, false],
  'roles:write': [true, false, false],
  'settings:write': [true, false, false],
  'audit:read': [true, true, false],
  'export:csv': [true, true, false],
};

const ROLE_COLUMN: Record<AdminRole, number> = { owner: 0, moderator: 1, viewer: 2 };

describe('permission map', () => {
  it('covers exactly the permissions in the table', () => {
    expect([...PERMISSIONS].sort()).toEqual(Object.keys(TABLE).sort());
  });

  it('has exactly the three roles', () => {
    expect([...ADMIN_ROLES]).toEqual(['owner', 'moderator', 'viewer']);
  });

  for (const role of ADMIN_ROLES) {
    for (const permission of PERMISSIONS) {
      const expected = TABLE[permission][ROLE_COLUMN[role]];
      it(`${role} ${expected ? 'has' : 'lacks'} ${permission}`, () => {
        expect(can(role, permission)).toBe(expected);
      });
    }
  }

  it('every role can enter the admin (analytics:read)', () => {
    for (const role of ADMIN_ROLES) expect(can(role, 'analytics:read')).toBe(true);
  });

  it('grants nothing to a missing or unknown role', () => {
    for (const permission of PERMISSIONS) {
      expect(can(null, permission)).toBe(false);
      expect(can(undefined, permission)).toBe(false);
      expect(can('admin' as AdminRole, permission)).toBe(false);
      expect(can('__proto__' as AdminRole, permission)).toBe(false);
    }
  });

  it('isAdminRole accepts only the three role strings', () => {
    expect(isAdminRole('owner')).toBe(true);
    expect(isAdminRole('viewer')).toBe(true);
    expect(isAdminRole('Owner')).toBe(false);
    expect(isAdminRole('')).toBe(false);
    expect(isAdminRole(1)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });

  it('permissionsFor lists the role column in table order', () => {
    expect(permissionsFor('viewer')).toEqual([
      'analytics:read',
      'files:read',
      'rooms:read',
      'users:read',
      'blocks:read',
    ]);
    expect(permissionsFor('owner')).toEqual([...PERMISSIONS]);
  });
});
