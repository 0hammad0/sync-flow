import { describe, expect, it } from 'vitest';
import { can, type Permission } from '@/server/auth/permissions';
import type { AdminRole } from '@/server/auth/types';
import {
  RECENT_KEY,
  actionEntries,
  allowedPaletteActions,
  filterEntries,
  matchIndexes,
  pageEntries,
  pushRecent,
  readRecent,
} from '@/features/admin/shell/command-registry';
import { NAV_GROUPS, filterNav, type NavGroup } from '@/features/admin/shell/nav';

const forRole = (role: AdminRole) => (p: Permission) => can(role, p);
const titles = (role: AdminRole) => pageEntries(filterNav(NAV_GROUPS, forRole(role))).map((e) => e.title);

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe('palette pages come from the sidebar nav', () => {
  it('lists exactly the sidebar items the role can see, in sidebar order', () => {
    for (const role of ['owner', 'moderator', 'viewer'] as const) {
      const sidebar = filterNav(NAV_GROUPS, forRole(role)).flatMap((g) => g.items.map((i) => i.label));
      expect(titles(role)).toEqual(sidebar);
    }
  });

  it('a viewer gets no Settings or Audit log; an owner gets both', () => {
    expect(titles('viewer')).not.toContain('Settings');
    expect(titles('viewer')).not.toContain('Audit log');
    expect(titles('owner')).toEqual(expect.arrayContaining(['Settings', 'Audit log', 'Users']));
  });

  it('a new sidebar entry flows into the palette with no registry change', () => {
    const groups: NavGroup[] = [
      ...NAV_GROUPS,
      { id: 'extra', label: 'Extra', items: [{ href: '/admin/new-screen', label: 'New screen', icon: 'pages', permission: 'analytics:read' }] },
    ];
    const entries = pageEntries(filterNav(groups, forRole('viewer')));
    expect(entries.at(-1)).toMatchObject({ id: 'page:/admin/new-screen', title: 'New screen', href: '/admin/new-screen' });
  });
});

describe('palette actions', () => {
  it('New block needs blocks:write: never for a viewer', () => {
    expect(allowedPaletteActions(forRole('viewer'))).not.toContain('new-block');
    expect(allowedPaletteActions(forRole('moderator'))).toContain('new-block');
    expect(allowedPaletteActions(forRole('viewer'))).toEqual(
      expect.arrayContaining(['toggle-theme', 'toggle-pin', 'copy-url', 'sign-out', 'sign-out-everywhere']),
    );
  });

  it('actionEntries keeps only the ids it is given', () => {
    expect(actionEntries(['sign-out']).map((e) => e.actionId)).toEqual(['sign-out']);
  });
});

describe('filtering', () => {
  it('matches a substring, else the letters in order, case-insensitive', () => {
    expect(matchIndexes('ses', 'Sessions')).toEqual([0, 1, 2]);
    expect(matchIndexes('acl', 'Access control')).toEqual([0, 1, 13]);
    expect(matchIndexes('xyz', 'Sessions')).toBeNull();
  });

  it('ranks title prefix before substring before letters, then keywords', () => {
    const entries = pageEntries(filterNav(NAV_GROUPS, forRole('owner')));
    const hits = filterEntries([...entries, ...actionEntries(['toggle-theme'])], 'se');
    expect(hits[0].entry.title).toBe('Sessions');
    expect(hits.map((h) => h.entry.title)).toContain('Settings');
    expect(filterEntries(actionEntries(['toggle-theme']), 'dark').map((h) => h.entry.title)).toEqual(['Toggle theme']);
  });
});

describe('recent', () => {
  const pages = pageEntries(filterNav(NAV_GROUPS, forRole('viewer')));

  it('keeps the last 5, newest first, without duplicates', () => {
    const storage = memoryStorage();
    for (const n of [1, 2, 3, 4, 5, 6, 3]) pushRecent(storage, { id: `page:${n}`, title: `T${n}`, href: '/admin/sessions' }, true);
    const stored = JSON.parse(storage.data.get(RECENT_KEY)!) as { id: string }[];
    expect(stored.map((r) => r.id)).toEqual(['page:3', 'page:6', 'page:5', 'page:4', 'page:2']);
  });

  it('never stores an IP for a role without ip:read', () => {
    const storage = memoryStorage();
    pushRecent(storage, { id: 'ip:sessions', title: 'Sessions from 203.0.113.7', href: '/admin/sessions?q=203.0.113.7' }, false);
    pushRecent(storage, { id: 'ip6', title: 'Sessions', href: '/admin/sessions?q=2001:db8::1' }, false);
    expect(storage.data.get(RECENT_KEY)).toBeUndefined();
  });

  it('drops stored links to screens the role can no longer open, and junk', () => {
    const storage = memoryStorage({
      [RECENT_KEY]: JSON.stringify([
        { id: 'a', title: 'Settings', href: '/admin/settings' },
        { id: 'b', title: 'Sessions', href: '/admin/sessions?q=x' },
        { id: 'c', title: 'Evil', href: 'https://example.com' },
        'junk',
      ]),
    });
    expect(readRecent(storage, pages).map((r) => r.title)).toEqual(['Sessions']);
    expect(readRecent(memoryStorage({ [RECENT_KEY]: '{bad' }), pages)).toEqual([]);
    expect(readRecent(null, pages)).toEqual([]);
  });
});
