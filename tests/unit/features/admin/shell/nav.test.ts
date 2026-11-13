import { describe, expect, it } from 'vitest';
import { ADMIN_ROLES, can } from '@/server/auth/permissions';
import type { AdminRole } from '@/server/auth/types';
import { NAV_GROUPS, breadcrumbsFor, filterNav, isNavItemActive } from '@/features/admin/shell/nav';

const labelsFor = (role: AdminRole) =>
  filterNav(NAV_GROUPS, (p) => can(role, p)).flatMap((g) => g.items.map((i) => i.label));

describe('filterNav', () => {
  it('shows the owner every item', () => {
    expect(labelsFor('owner')).toEqual(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label)));
  });

  it('hides Settings from moderators', () => {
    const labels = labelsFor('moderator');
    expect(labels).not.toContain('Settings');
    expect(labels).toContain('Audit log');
    expect(labels).toContain('Access control');
  });

  it('hides Audit log and Settings from viewers', () => {
    const labels = labelsFor('viewer');
    expect(labels).not.toContain('Audit log');
    expect(labels).not.toContain('Settings');
    expect(labels).toEqual(expect.arrayContaining(['Overview', 'Sessions', 'Files & storage', 'Access control', 'Health']));
  });

  it('never shows an item whose permission the role lacks', () => {
    for (const role of ADMIN_ROLES) {
      for (const group of filterNav(NAV_GROUPS, (p) => can(role, p))) {
        for (const item of group.items) expect(can(role, item.permission)).toBe(true);
      }
    }
  });

  it('drops groups left empty', () => {
    const groups = filterNav(NAV_GROUPS, (p) => p === 'analytics:read');
    expect(groups.map((g) => g.id)).toEqual(['home', 'analytics', 'system']);
    expect(filterNav(NAV_GROUPS, () => false)).toEqual([]);
  });

  it('does not mutate the config', () => {
    const before = JSON.stringify(NAV_GROUPS);
    filterNav(NAV_GROUPS, () => false);
    expect(JSON.stringify(NAV_GROUPS)).toBe(before);
  });
});

describe('isNavItemActive', () => {
  it('matches Overview only on /admin itself', () => {
    expect(isNavItemActive('/admin', '/admin')).toBe(true);
    expect(isNavItemActive('/admin', '/admin/sessions')).toBe(false);
  });

  it('matches an item and its sub-paths, not a prefix of another word', () => {
    expect(isNavItemActive('/admin/sessions', '/admin/sessions')).toBe(true);
    expect(isNavItemActive('/admin/sessions', '/admin/sessions/7f3a')).toBe(true);
    expect(isNavItemActive('/admin/users', '/admin/users-export')).toBe(false);
  });
});

describe('breadcrumbsFor', () => {
  it('is Overview on /admin', () => {
    expect(breadcrumbsFor('/admin')).toEqual([{ label: 'Overview', href: '/admin' }]);
    expect(breadcrumbsFor('/admin/')).toEqual([{ label: 'Overview', href: '/admin' }]);
  });

  it('uses nav labels and shortens long ids', () => {
    expect(breadcrumbsFor('/admin/sessions/7f3a9c2e4b1d')).toEqual([
      { label: 'Sessions', href: '/admin/sessions' },
      { label: '7f3a9c2e…', href: '/admin/sessions/7f3a9c2e4b1d' },
    ]);
  });

  it('decodes segments and survives malformed escapes', () => {
    expect(breadcrumbsFor('/admin/files/a%20b')[1].label).toBe('a b');
    expect(breadcrumbsFor('/admin/files/%E0%A4')[1].label).toBe('%E0%A4');
  });
});
